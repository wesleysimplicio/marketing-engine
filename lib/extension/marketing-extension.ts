import { createHash } from "node:crypto";

/** The versioned wire contract owned by simplicio-loop (issue #557). */
export const LOOP_EXTENSION_SCHEMA = "simplicio.loop-extension/v1" as const;
export const MARKETING_EXTENSION_ID = "loop.marketing" as const;

export type OverlayOperation = "insert_before" | "insert_after" | "wrap" | "refine";

export interface MarketingStageOverlay {
  id: string;
  operation: OverlayOperation;
  hook: "intake" | "planning" | "executing" | "validating" | "watching" | "recovery" | "delivering" | "reporting" | "completion";
  handler: string;
  depends_on?: string[];
  resource_class: string;
  deterministic: boolean;
  effect?: boolean;
}

export interface MarketingExtensionManifest {
  schema: typeof LOOP_EXTENSION_SCHEMA;
  extension_id: typeof MARKETING_EXTENSION_ID;
  name: string;
  version: string;
  domain: "marketing";
  requires_core: string;
  capabilities: { requires: string[]; provides: string[] };
  context_schemas: string[];
  stage_overlays: MarketingStageOverlay[];
  role_bindings: MarketingRoleBinding[];
  resource_classes: Record<string, { concurrency_cap: number; budget_scope: string }>;
  effect_handlers: Array<{ handler: string; requires: string[] }>;
}

export interface MarketingRoleBinding {
  role_id: string;
  specializes: "planner" | "researcher" | "implementer" | "reviewer" | "operator" | "auditor";
  stage_id: MarketingStageOverlay["hook"];
  capabilities: string[];
  independent_from: string[];
}

const overlays: MarketingStageOverlay[] = [
  { id: "marketing.brief", operation: "refine", hook: "intake", handler: "marketing.brief", resource_class: "cpu", deterministic: true },
  { id: "marketing.strategy", operation: "insert_after", hook: "planning", handler: "marketing.strategy", depends_on: ["marketing.brief"], resource_class: "reasoning", deterministic: false },
  { id: "marketing.copy", operation: "insert_after", hook: "executing", handler: "marketing.copy", depends_on: ["marketing.strategy"], resource_class: "llm", deterministic: false },
  { id: "marketing.creative", operation: "insert_after", hook: "executing", handler: "marketing.creative", depends_on: ["marketing.strategy"], resource_class: "creative", deterministic: false },
  { id: "marketing.caption-format", operation: "insert_before", hook: "validating", handler: "marketing.caption-format", depends_on: ["marketing.copy"], resource_class: "cpu", deterministic: true },
  { id: "marketing.semantic-review", operation: "refine", hook: "validating", handler: "marketing.semantic-review", depends_on: ["marketing.copy"], resource_class: "reasoning", deterministic: false },
  { id: "marketing.compliance", operation: "refine", hook: "validating", handler: "marketing.compliance", depends_on: ["marketing.caption-format", "marketing.semantic-review", "marketing.creative"], resource_class: "cpu", deterministic: true },
  { id: "marketing.provider-watch", operation: "refine", hook: "watching", handler: "marketing.provider-watch", depends_on: ["marketing.compliance"], resource_class: "cpu", deterministic: true },
  { id: "marketing.publish", operation: "insert_after", hook: "delivering", handler: "marketing.publish", depends_on: ["marketing.provider-watch"], resource_class: "social-api", deterministic: true, effect: true },
  { id: "marketing.metrics", operation: "insert_after", hook: "reporting", handler: "marketing.metrics", depends_on: ["marketing.publish"], resource_class: "social-api", deterministic: true },
  { id: "marketing.evidence", operation: "refine", hook: "completion", handler: "marketing.evidence", depends_on: ["marketing.metrics"], resource_class: "cpu", deterministic: true },
];

/** Dedicated domain roles; lifecycle, scheduling, leases and completion stay in Loop core. */
const roleBindings: MarketingRoleBinding[] = [
  { role_id: "marketing.campaign-intake", specializes: "planner", stage_id: "intake", capabilities: ["marketing.brief"], independent_from: [] },
  { role_id: "marketing.product-icp-research", specializes: "researcher", stage_id: "planning", capabilities: ["marketing.research", "marketing.icp"], independent_from: ["marketing.completion-auditor"] },
  { role_id: "marketing.channel-content-planner", specializes: "planner", stage_id: "planning", capabilities: ["marketing.channel-plan"], independent_from: ["marketing.completion-auditor"] },
  { role_id: "marketing.copy-script", specializes: "implementer", stage_id: "executing", capabilities: ["marketing.copy"], independent_from: ["marketing.brand-humanization", "marketing.compliance-safety"] },
  { role_id: "marketing.creative-image-video", specializes: "implementer", stage_id: "executing", capabilities: ["marketing.image", "marketing.video"], independent_from: ["marketing.brand-humanization", "marketing.compliance-safety"] },
  { role_id: "marketing.brand-humanization", specializes: "reviewer", stage_id: "validating", capabilities: ["marketing.brand", "marketing.humanization"], independent_from: ["marketing.copy-script", "marketing.creative-image-video"] },
  { role_id: "marketing.compliance-safety", specializes: "reviewer", stage_id: "validating", capabilities: ["marketing.compliance", "marketing.safety"], independent_from: ["marketing.copy-script", "marketing.creative-image-video"] },
  { role_id: "marketing.technical-qa-runtime", specializes: "reviewer", stage_id: "validating", capabilities: ["marketing.qa", "marketing.runtime"], independent_from: ["marketing.publish-schedule"] },
  { role_id: "marketing.publish-schedule", specializes: "operator", stage_id: "delivering", capabilities: ["marketing.publish"], independent_from: ["marketing.completion-auditor"] },
  { role_id: "marketing.metrics-experimentation", specializes: "researcher", stage_id: "reporting", capabilities: ["marketing.metrics", "marketing.experiments"], independent_from: ["marketing.completion-auditor"] },
  { role_id: "marketing.promotion-ads", specializes: "operator", stage_id: "delivering", capabilities: ["marketing.ads"], independent_from: ["marketing.compliance-safety", "marketing.completion-auditor"] },
  { role_id: "marketing.community-reply", specializes: "operator", stage_id: "watching", capabilities: ["marketing.community"], independent_from: ["marketing.compliance-safety"] },
  { role_id: "marketing.feedback-recovery", specializes: "operator", stage_id: "recovery", capabilities: ["marketing.feedback", "marketing.recovery"], independent_from: ["marketing.completion-auditor"] },
  { role_id: "marketing.completion-auditor", specializes: "auditor", stage_id: "completion", capabilities: ["marketing.completion-audit"], independent_from: ["marketing.campaign-intake", "marketing.product-icp-research", "marketing.channel-content-planner", "marketing.copy-script", "marketing.creative-image-video", "marketing.brand-humanization", "marketing.compliance-safety", "marketing.technical-qa-runtime", "marketing.publish-schedule", "marketing.metrics-experimentation", "marketing.promotion-ads", "marketing.community-reply", "marketing.feedback-recovery"] },
];

export const marketingExtensionManifest: MarketingExtensionManifest = Object.freeze({
  schema: LOOP_EXTENSION_SCHEMA,
  extension_id: MARKETING_EXTENSION_ID,
  name: "Marketing Engine",
  version: "1.0.0",
  domain: "marketing",
  requires_core: ">=1.0.0 <2.0.0",
  capabilities: {
    requires: ["core.stage-graph/v1", "core.receipts/v1", "core.effects/fenced-v1"],
    provides: ["marketing.piece/v1", "marketing.pipeline/v1"],
  },
  context_schemas: ["marketing.campaign/v1", "marketing.piece/v1", "marketing.channel/v1", "marketing.brand-context/v1"],
  stage_overlays: overlays,
  role_bindings: roleBindings,
  resource_classes: {
    cpu: { concurrency_cap: 8, budget_scope: "tenant" },
    reasoning: { concurrency_cap: 2, budget_scope: "tenant" },
    llm: { concurrency_cap: 4, budget_scope: "provider+tenant" },
    creative: { concurrency_cap: 2, budget_scope: "provider+tenant" },
    "social-api": { concurrency_cap: 1, budget_scope: "provider+tenant" },
  },
  effect_handlers: [
    { handler: "marketing.publish", requires: ["intent", "authorization", "idempotency_key", "fence_token", "confirmation", "receipt"] },
  ],
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable identity recorded by the core in every composed-graph receipt. */
export function marketingManifestHash(manifest: MarketingExtensionManifest = marketingExtensionManifest): string {
  return `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`;
}

export function validateMarketingManifest(manifest: MarketingExtensionManifest): string[] {
  const errors: string[] = [];
  if (manifest.schema !== LOOP_EXTENSION_SCHEMA) errors.push(`unsupported schema: ${manifest.schema}`);
  if (manifest.extension_id !== MARKETING_EXTENSION_ID) errors.push("extension_id must be loop.marketing");
  const ids = new Set<string>();
  for (const overlay of manifest.stage_overlays) {
    if (!["insert_before", "insert_after", "wrap", "refine"].includes(overlay.operation)) errors.push(`forbidden overlay operation: ${String(overlay.operation)}`);
    if (ids.has(overlay.id)) errors.push(`duplicate overlay: ${overlay.id}`);
    ids.add(overlay.id);
    if (!manifest.resource_classes[overlay.resource_class]) errors.push(`unknown resource class: ${overlay.resource_class}`);
    if (overlay.effect && !manifest.effect_handlers.some((effect) => effect.handler === overlay.handler)) errors.push(`effect lacks governance declaration: ${overlay.handler}`);
  }
  const roleIds = new Set<string>();
  for (const role of manifest.role_bindings) {
    if (roleIds.has(role.role_id)) errors.push(`duplicate role: ${role.role_id}`);
    roleIds.add(role.role_id);
    if (role.independent_from.includes(role.role_id)) errors.push(`role cannot independently review itself: ${role.role_id}`);
    for (const peer of role.independent_from) if (!manifest.role_bindings.some((candidate) => candidate.role_id === peer)) errors.push(`role references unknown peer: ${peer}`);
  }
  for (const overlay of manifest.stage_overlays) {
    for (const dependency of overlay.depends_on ?? []) if (!ids.has(dependency)) errors.push(`unknown dependency: ${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(manifest.stage_overlays.map((overlay) => [overlay.id, overlay]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) if (byId.has(dependency) && visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of byId.keys()) if (visit(id)) { errors.push("overlay dependency cycle"); break; }
  return errors;
}
