/**
 * The TypeScript side of `simplicio.loop-extension/v1`.
 *
 * This module is deliberately declarative: it validates and composes a
 * manifest, but it never owns a queue, scheduler, lease, receipt ledger, or
 * completion transition. Those responsibilities stay in the Loop core.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_SCHEMA = "simplicio.loop-extension/v1" as const;
export const HANDSHAKE_SCHEMA = "simplicio.extension-handshake/v1" as const;
export const GATE_SEVERITIES = ["off", "warn", "block", "fail_closed"] as const;
export type GateSeverity = (typeof GATE_SEVERITIES)[number];
const GATE_RANK: Record<GateSeverity, number> = { off: 0, warn: 1, block: 2, fail_closed: 3 };
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ID_RE = /^[a-z][a-z0-9_-]*$/;
const OVERLAY_OPS = ["insert_before", "insert_after", "wrap", "refine"] as const;

export interface ExtensionManifest {
  schema: typeof EXTENSION_SCHEMA;
  extension_id: string;
  name: string;
  version: string;
  domain: string;
  requires_core: { min_version: string; max_version: string };
  capabilities: { requires: string[]; provides: string[]; forbidden?: string[] };
  source_adapters: Array<{ adapter_id: string; kind: string }>;
  context_schemas: Array<{ schema_id: string; version: string; migrations?: string[] }>;
  stage_overlays: StageOverlay[];
  role_bindings: RoleBinding[];
  gates: Array<{ gate_id: string; severity: GateSeverity }>;
  effect_handlers: EffectHandler[];
  resource_classes: Array<{ class_id: string; concurrency_cap: number; budget?: Record<string, number> }>;
  receipt_schemas: Array<{ schema_id: string; version: string }>;
  feature_flags: Array<{ flag_id: string; default: boolean }>;
}

export interface StageOverlay {
  op: (typeof OVERLAY_OPS)[number];
  hook: string;
  stage?: { stage_id: string; depends_on?: string[]; gates?: Record<string, GateSeverity>; mandatory?: boolean };
  gates?: Record<string, GateSeverity>;
  order?: number;
}

export interface RoleBinding {
  role_id: string;
  specializes: string;
  required_capabilities: string[];
  stage_id?: string;
  capabilities?: string[];
  forbidden_capabilities?: string[];
  independent_from?: string[];
}

export interface EffectHandler {
  effect_id: string;
  idempotent: true;
  requires_fence_token: true;
  requires_receipt: true;
  compensation?: string;
}

export interface CoreStage {
  stage_id: string;
  depends_on: string[];
  mandatory: boolean;
  gates: Record<string, GateSeverity>;
}

export const CORE_STAGE_GRAPH: CoreStage[] = [
  { stage_id: "intake", depends_on: [], mandatory: true, gates: { contract: "fail_closed" } },
  { stage_id: "execute", depends_on: ["intake"], mandatory: true, gates: { process_spec: "fail_closed" } },
  { stage_id: "quality", depends_on: ["execute"], mandatory: true, gates: { quality: "block" } },
  { stage_id: "watcher", depends_on: ["quality"], mandatory: true, gates: { evidence: "fail_closed" } },
  { stage_id: "delivery", depends_on: ["watcher"], mandatory: true, gates: { delivery: "fail_closed" } },
  { stage_id: "oracle", depends_on: ["delivery"], mandatory: true, gates: { completion: "fail_closed" } },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function semver(value: unknown): value is string { return typeof value === "string" && VERSION_RE.test(value); }
function unknownFields(value: Record<string, unknown>, allowed: string[], path: string): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key)).sort().map((key) => `${path} contains unknown field: ${key}`);
}
function list(value: unknown, path: string): unknown[] | null { return Array.isArray(value) ? value : null; }

export function validateManifest(value: unknown): string[] {
  if (!isObject(value)) return ["manifest must be an object"];
  const errors: string[] = [];
  const top = ["schema", "extension_id", "name", "version", "domain", "requires_core", "capabilities", "source_adapters", "context_schemas", "stage_overlays", "role_bindings", "gates", "effect_handlers", "resource_classes", "receipt_schemas", "feature_flags"];
  errors.push(...unknownFields(value, top, "manifest"));
  for (const field of ["schema", "extension_id", "name", "version", "domain", "requires_core"]) if (!(field in value)) errors.push(`manifest is missing required field: ${field}`);
  if (value.schema !== EXTENSION_SCHEMA) errors.push(`manifest.schema must be ${EXTENSION_SCHEMA}`);
  if (!nonEmpty(value.extension_id) || !ID_RE.test(value.extension_id)) errors.push("manifest.extension_id must be lower_snake identifier");
  if (!nonEmpty(value.name)) errors.push("manifest.name must be non-empty");
  if (!semver(value.version)) errors.push("manifest.version must be semver");
  if (!nonEmpty(value.domain)) errors.push("manifest.domain must be non-empty");

  if (!isObject(value.requires_core)) errors.push("manifest.requires_core must be an object");
  else {
    errors.push(...unknownFields(value.requires_core, ["min_version", "max_version"], "manifest.requires_core"));
    if (!semver(value.requires_core.min_version) || !semver(value.requires_core.max_version)) errors.push("manifest.requires_core versions must be semver");
    else if (compareVersions(value.requires_core.min_version, value.requires_core.max_version) > 0) errors.push("manifest.requires_core min_version must be <= max_version");
  }
  if (!isObject(value.capabilities)) errors.push("manifest.capabilities must be an object");
  else {
    errors.push(...unknownFields(value.capabilities, ["requires", "provides", "forbidden"], "manifest.capabilities"));
    for (const field of ["requires", "provides", "forbidden"]) if (field in value.capabilities && (!Array.isArray(value.capabilities[field]) || !(value.capabilities[field] as unknown[]).every(nonEmpty))) errors.push(`manifest.capabilities.${field} must be an array of non-empty strings`);
  }
  const arrays: Array<[string, (item: Record<string, unknown>, path: string) => string[]]> = [
    ["source_adapters", (item, path) => validateSimple(item, path, ["adapter_id", "kind"], ["adapter_id", "kind"])],
    ["context_schemas", (item, path) => validateSimple(item, path, ["schema_id", "version", "migrations"], ["schema_id", "version"])],
    ["role_bindings", (item, path) => validateSimple(item, path, ["role_id", "specializes", "required_capabilities", "stage_id", "capabilities", "forbidden_capabilities", "independent_from"], ["role_id", "specializes", "required_capabilities"])],
    ["receipt_schemas", (item, path) => validateSimple(item, path, ["schema_id", "version"], ["schema_id", "version"])],
    ["feature_flags", (item, path) => validateSimple(item, path, ["flag_id", "default"], ["flag_id"])],
  ];
  for (const [field, check] of arrays) {
    if (!(field in value)) continue;
    const items = list(value[field], `manifest.${field}`);
    if (!items) { errors.push(`manifest.${field} must be an array`); continue; }
    items.forEach((item, index) => errors.push(...(isObject(item) ? check(item, `manifest.${field}[${index}]`) : [`manifest.${field}[${index}] must be an object`])));
  }
  const gates = list(value.gates, "manifest.gates");
  if (gates) gates.forEach((item, index) => { if (!isObject(item)) errors.push(`manifest.gates[${index}] must be an object`); else { errors.push(...unknownFields(item, ["gate_id", "severity"], `manifest.gates[${index}]`)); if (!nonEmpty(item.gate_id)) errors.push(`manifest.gates[${index}].gate_id is required`); if (!GATE_SEVERITIES.includes(item.severity as GateSeverity)) errors.push(`manifest.gates[${index}].severity is invalid`); } });
  else if ("gates" in value) errors.push("manifest.gates must be an array");
  const effects = list(value.effect_handlers, "manifest.effect_handlers");
  if (effects) effects.forEach((item, index) => { if (!isObject(item)) errors.push(`manifest.effect_handlers[${index}] must be an object`); else { errors.push(...unknownFields(item, ["effect_id", "idempotent", "requires_fence_token", "requires_receipt", "compensation"], `manifest.effect_handlers[${index}]`)); if (!nonEmpty(item.effect_id)) errors.push(`manifest.effect_handlers[${index}].effect_id is required`); for (const field of ["idempotent", "requires_fence_token", "requires_receipt"]) if (item[field] !== true) errors.push(`manifest.effect_handlers[${index}].${field} must be true`); } });
  else if ("effect_handlers" in value) errors.push("manifest.effect_handlers must be an array");
  const resources = list(value.resource_classes, "manifest.resource_classes");
  if (resources) resources.forEach((item, index) => { if (!isObject(item)) errors.push(`manifest.resource_classes[${index}] must be an object`); else { errors.push(...unknownFields(item, ["class_id", "concurrency_cap", "budget"], `manifest.resource_classes[${index}]`)); if (!nonEmpty(item.class_id)) errors.push(`manifest.resource_classes[${index}].class_id is required`); if (!Number.isInteger(item.concurrency_cap) || (item.concurrency_cap as number) < 0) errors.push(`manifest.resource_classes[${index}].concurrency_cap must be non-negative integer`); } });
  else if ("resource_classes" in value) errors.push("manifest.resource_classes must be an array");
  const overlays = list(value.stage_overlays, "manifest.stage_overlays");
  if (overlays) overlays.forEach((item, index) => errors.push(...validateOverlay(item, `manifest.stage_overlays[${index}]`)));
  else if ("stage_overlays" in value) errors.push("manifest.stage_overlays must be an array");
  return errors;
}

function validateSimple(item: Record<string, unknown>, path: string, allowed: string[], required: string[]): string[] {
  const errors = unknownFields(item, allowed, path);
  for (const field of required) {
    if (field === "required_capabilities") {
      if (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(nonEmpty)) errors.push(`${path}.${field} must be an array of strings`);
    } else if (!nonEmpty(item[field])) errors.push(`${path}.${field} is required`);
  }
  if ("version" in item && !semver(item.version)) errors.push(`${path}.version must be semver`);
  if ("migrations" in item && !Array.isArray(item.migrations)) errors.push(`${path}.migrations must be an array`);
  if ("default" in item && typeof item.default !== "boolean") errors.push(`${path}.default must be boolean`);
  for (const field of ["required_capabilities", "capabilities", "forbidden_capabilities", "independent_from"]) if (field in item && (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(nonEmpty))) errors.push(`${path}.${field} must be an array of strings`);
  return errors;
}

function validateOverlay(item: unknown, path: string): string[] {
  if (!isObject(item)) return [`${path} must be an object`];
  const errors = unknownFields(item, ["op", "hook", "stage", "gates", "order"], path);
  if (!OVERLAY_OPS.includes(item.op as (typeof OVERLAY_OPS)[number])) errors.push(`${path}.op must be one of ${OVERLAY_OPS.join(", ")}`);
  if (!nonEmpty(item.hook)) errors.push(`${path}.hook is required`);
  if (["insert_before", "insert_after"].includes(String(item.op))) {
    if (!isObject(item.stage)) errors.push(`${path}.stage is required`);
    else { errors.push(...unknownFields(item.stage, ["stage_id", "depends_on", "gates", "mandatory"], `${path}.stage`)); if (!nonEmpty(item.stage.stage_id)) errors.push(`${path}.stage.stage_id is required`); if (item.stage.mandatory === true) errors.push(`${path}.stage.mandatory must not be true`); if (item.stage.depends_on !== undefined && !Array.isArray(item.stage.depends_on)) errors.push(`${path}.stage.depends_on must be an array`); }
  } else if (["wrap", "refine"].includes(String(item.op))) {
    if ("stage" in item) errors.push(`${path}.stage is not valid for ${String(item.op)}`);
  }
  if (item.gates !== undefined && (!isObject(item.gates) || Object.values(item.gates).some((v) => !GATE_SEVERITIES.includes(v as GateSeverity)))) errors.push(`${path}.gates must contain valid severities`);
  if (item.order !== undefined && !Number.isInteger(item.order)) errors.push(`${path}.order must be integer`);
  return errors;
}

function compareVersions(a: string, b: string): number { const av = a.split(".").map(Number); const bv = b.split(".").map(Number); return av[0] - bv[0] || av[1] - bv[1] || av[2] - bv[2]; }
export function versionInRange(version: string, range: { min_version: string; max_version: string }): boolean { return compareVersions(version, range.min_version) >= 0 && compareVersions(version, range.max_version) <= 0; }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
export function manifestHash(manifest: ExtensionManifest): string { return `sha256:${createHash("sha256").update(JSON.stringify(canonical(manifest))).digest("hex")}`; }

export function composeStageGraph(coreStages: CoreStage[], extensions: ExtensionManifest[]): { ok: boolean; errors: string[]; graph_hash?: string; stages: Array<CoreStage & { wrapped_by: string[]; refined_by: string[]; introduced_by?: string }> } {
  const errors: string[] = [];
  const stages = new Map<string, CoreStage & { wrapped_by: string[]; refined_by: string[]; introduced_by?: string }>();
  const order: string[] = [];
  const mandatory = new Set<string>();
  for (const stage of coreStages) { if (stages.has(stage.stage_id)) errors.push(`duplicate core stage: ${stage.stage_id}`); else { stages.set(stage.stage_id, { ...stage, depends_on: [...stage.depends_on], gates: { ...stage.gates }, wrapped_by: [], refined_by: [] }); order.push(stage.stage_id); if (stage.mandatory) mandatory.add(stage.stage_id); } }
  const ops = extensions.flatMap((extension) => extension.stage_overlays.map((overlay, index) => ({ extension, overlay, index }))).sort((a, b) => (a.overlay.order ?? a.index) - (b.overlay.order ?? b.index) || a.extension.extension_id.localeCompare(b.extension.extension_id) || a.index - b.index);
  for (const { extension, overlay, index } of ops) {
    const path = `extension ${extension.extension_id} stage_overlays[${index}]`;
    const hook = stages.get(overlay.hook);
    if (!hook) { errors.push(`${path}: hook target ${overlay.hook} does not exist`); continue; }
    if (overlay.op === "insert_before" || overlay.op === "insert_after") {
      const definition = overlay.stage!;
      if (stages.has(definition.stage_id)) { errors.push(`${path}: stage ${definition.stage_id} collides`); continue; }
      const depends = [...(definition.depends_on ?? [])]; if (overlay.op === "insert_after" && !depends.includes(overlay.hook)) depends.push(overlay.hook);
      stages.set(definition.stage_id, { stage_id: definition.stage_id, depends_on: depends, mandatory: false, gates: { ...(definition.gates ?? {}) }, wrapped_by: [], refined_by: [], introduced_by: extension.extension_id });
      order.splice(overlay.op === "insert_before" ? order.indexOf(overlay.hook) : order.indexOf(overlay.hook) + 1, 0, definition.stage_id);
    } else {
      const bucket = overlay.op === "wrap" ? "wrapped_by" : "refined_by";
      hook[bucket].push(extension.extension_id);
      for (const [gate, severity] of Object.entries(overlay.gates ?? {})) { const current = hook.gates[gate] ?? "off"; if (GATE_RANK[severity] < GATE_RANK[current]) errors.push(`${path}: cannot weaken gate ${gate} on ${overlay.hook}`); else hook.gates[gate] = severity; }
    }
  }
  for (const stage of stages.values()) for (const dependency of stage.depends_on) if (!stages.has(dependency)) errors.push(`stage ${stage.stage_id} depends on unknown stage ${dependency}`);
  const colors = new Map<string, number>();
  const visit = (id: string): void => { if (colors.get(id) === 1) { errors.push(`stage graph cycle at ${id}`); return; } if (colors.get(id) === 2) return; colors.set(id, 1); for (const dependency of stages.get(id)?.depends_on ?? []) visit(dependency); colors.set(id, 2); };
  for (const id of order) visit(id);
  if (![...mandatory].every((id) => stages.get(id)?.mandatory)) errors.push("mandatory core stage missing");
  if (errors.length) return { ok: false, errors, stages: [] };
  const result = order.map((id) => stages.get(id)!);
  return { ok: true, errors: [], graph_hash: `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`, stages: result };
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MARKETING_MANIFEST_PATH = join(PACKAGE_ROOT, "extensions", "loop.marketing", "manifest.json");
export function loadMarketingManifest(path = MARKETING_MANIFEST_PATH): ExtensionManifest {
  if (!existsSync(path)) throw new Error(`marketing extension manifest missing: ${path}`);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ExtensionManifest;
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`invalid marketing extension manifest: ${errors.join("; ")}`);
  return manifest;
}

export function extensionMetadata(manifest = loadMarketingManifest(), coreVersion?: string, graph = composeStageGraph(CORE_STAGE_GRAPH, [manifest])) {
  return { extension_id: manifest.extension_id, extension_version: manifest.version, manifest_schema: manifest.schema, manifest_hash: manifestHash(manifest), upstream_version: coreVersion ?? null, graph_hash: graph.graph_hash ?? null };
}
