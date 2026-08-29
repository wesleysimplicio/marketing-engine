import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { appendHbp, readHbi, readHbp, writeHbiAtomic } from "../formats/binary";

export const REFERENCE_SOURCE_SCHEMA = "marketing-reference-source/v1" as const;
export const REFERENCE_RECEIPT_SCHEMA = "marketing-reference-receipt/v1" as const;
export type ReferenceKind = "youtube" | "url" | "file" | "transcript";
export type ReferenceStatus = "ingested" | "deferred" | "rejected";

export interface ReferenceInput {
  value: string;
  kind?: ReferenceKind;
  root?: string;
  supplied_transcript?: string;
  language?: string;
  duration_seconds?: number;
  permissions?: "unknown" | "granted" | "denied";
  max_bytes?: number;
  allow_hosts?: string[];
  dry_run?: boolean;
}

export interface ReferenceSource {
  schema: typeof REFERENCE_SOURCE_SCHEMA;
  source_id: string;
  kind: ReferenceKind;
  origin: "youtube" | "url" | "file" | "supplied_transcript";
  canonical_uri: string;
  content_sha256: string | null;
  language: string | null;
  duration_seconds: number | null;
  permissions: "unknown" | "granted" | "denied";
  collected_at: string;
  status: ReferenceStatus;
  reason: string | null;
  idempotency_key: string;
}

export interface ReferenceReceipt {
  schema: typeof REFERENCE_RECEIPT_SCHEMA;
  receipt_id: string;
  source_id: string;
  status: ReferenceStatus;
  source_sha256: string;
  reason: string | null;
  created_at: string;
}

export interface IngestResult {
  source: ReferenceSource;
  receipt: ReferenceReceipt;
  reused: boolean;
  manifest_path: string;
  receipts_path: string;
}

interface ReferenceManifest { schema: "marketing-reference-manifest/v1"; sources: ReferenceSource[] }
const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const now = (): string => new Date().toISOString();
const defaultDryRun = (): boolean => process.env.DRY_RUN !== "false";

function paths(root: string): { dir: string; manifest: string; receipts: string } {
  const dir = resolve(root, "data", "references");
  return { dir, manifest: resolve(dir, "manifest.hbi"), receipts: resolve(dir, "receipts.hbp") };
}

function detectKind(value: string, suppliedTranscript?: string): ReferenceKind {
  if (suppliedTranscript !== undefined) return "transcript";
  if (/^https?:\/\//i.test(value)) return /(^|\.)youtu(?:be\.com|\.be)$/i.test(new URL(value).hostname) ? "youtube" : "url";
  return "file";
}

function canonicalUrl(raw: string): { kind: "youtube" | "url"; value: string } | { error: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { error: "invalid-url" }; }
  if (url.protocol !== "https:") return { error: "https-required" };
  const host = url.hostname.toLowerCase();
  const youtube = /(^|\.)youtu(?:be\.com|\.be)$/.test(host);
  if (!youtube && !host) return { error: "invalid-host" };
  const videoId = youtube ? url.searchParams.get("v") : null;
  const safe = `https://${host}${url.pathname}${videoId ? `?v=${encodeURIComponent(videoId)}` : ""}`;
  return { kind: youtube ? "youtube" : "url", value: safe };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.includes(`${sep}..${sep}`);
}

function persist(root: string, source: ReferenceSource, receipt: ReferenceReceipt): { manifest_path: string; receipts_path: string } {
  const target = paths(root);
  mkdirSync(target.dir, { recursive: true });
  let manifest: ReferenceManifest = { schema: "marketing-reference-manifest/v1", sources: [] };
  if (existsSync(target.manifest)) {
    try { manifest = readHbi<ReferenceManifest>(target.manifest); } catch { throw new Error("reference-manifest-corrupt"); }
  }
  const index = manifest.sources.findIndex((item) => item.source_id === source.source_id);
  if (index >= 0) manifest.sources[index] = source;
  else manifest.sources.push(source);
  manifest.sources.sort((a, b) => a.source_id.localeCompare(b.source_id));
  writeHbiAtomic(target.manifest, manifest);
  const prior = existsSync(target.receipts) ? readHbp<ReferenceReceipt>(target.receipts) : [];
  if (!prior.some((item) => item.receipt_id === receipt.receipt_id)) appendHbp(target.receipts, receipt);
  return { manifest_path: target.manifest, receipts_path: target.receipts };
}

function result(root: string, source: ReferenceSource, reason: string | null, reused = false): IngestResult {
  const receipt: ReferenceReceipt = {
    schema: REFERENCE_RECEIPT_SCHEMA,
    receipt_id: `reference:${source.source_id}`,
    source_id: source.source_id,
    status: source.status,
    source_sha256: sha256(JSON.stringify(source)),
    reason,
    created_at: now(),
  };
  const persisted = persist(root, source, receipt);
  return { source, receipt, reused, ...persisted };
}

/** Canonical, idempotent reference intake. It never fetches a network URL. */
export async function ingestReference(input: ReferenceInput): Promise<IngestResult> {
  const root = resolve(input.root ?? process.cwd());
  const permissions = input.permissions ?? "unknown";
  const kind = input.kind ?? detectKind(input.value, input.supplied_transcript);
  const collectedAt = now();
  let canonical = input.value;
  let actualKind: ReferenceKind = kind;
  let contentHash: string | null = null;
  let status: ReferenceStatus = "ingested";
  let reason: string | null = null;

  if (!input.value.trim()) { status = "rejected"; reason = "empty-source"; }
  else if (permissions === "denied") { status = "rejected"; reason = "permissions-denied"; }
  else if (input.supplied_transcript !== undefined || kind === "transcript") {
    if (!input.supplied_transcript?.trim()) { status = "rejected"; reason = "empty-transcript"; actualKind = "transcript"; }
    else { actualKind = "transcript"; canonical = "supplied-transcript"; contentHash = sha256(input.supplied_transcript); }
  } else if (kind === "file") {
    const candidate = resolve(root, input.value);
    actualKind = "file";
    if (!inside(root, candidate)) { status = "rejected"; reason = "path-outside-root"; }
    else if (!existsSync(candidate)) { status = "rejected"; reason = "file-not-found"; }
    else {
      try {
        const bytes = await readFile(candidate);
        const max = input.max_bytes ?? 50 * 1024 * 1024;
        if (bytes.byteLength > max) { status = "rejected"; reason = "file-too-large"; }
        else { contentHash = sha256(bytes); canonical = `file://${candidate}`; }
      } catch { status = "rejected"; reason = "file-unreadable"; }
    }
  } else {
    const parsed = canonicalUrl(input.value);
    if ("error" in parsed) { status = "rejected"; reason = parsed.error; }
    else {
      actualKind = input.kind === "youtube" && parsed.kind !== "youtube" ? "youtube" : parsed.kind;
      canonical = parsed.value;
      const host = new URL(canonical).hostname;
      if (input.allow_hosts?.length && !input.allow_hosts.map((item) => item.toLowerCase()).includes(host)) { status = "rejected"; reason = "host-not-allowlisted"; }
      else if (defaultDryRun() || input.dry_run !== false) { status = "deferred"; reason = "network-fetch-disabled-in-dry-run"; contentHash = null; }
      else { status = "deferred"; reason = "network-fetch-requires-provider-adapter"; contentHash = null; }
    }
  }

  const idempotencyKey = sha256(JSON.stringify({ kind: actualKind, canonical, contentHash, language: input.language ?? null }));
  const source: ReferenceSource = {
    schema: REFERENCE_SOURCE_SCHEMA,
    source_id: `ref-${idempotencyKey.slice(0, 24)}`,
    kind: actualKind,
    origin: actualKind === "transcript" ? "supplied_transcript" : actualKind,
    canonical_uri: canonical,
    content_sha256: contentHash,
    language: input.language ?? null,
    duration_seconds: input.duration_seconds ?? null,
    permissions,
    collected_at: collectedAt,
    status,
    reason,
    idempotency_key: idempotencyKey,
  };
  const target = paths(root);
  if (existsSync(target.manifest)) {
    try {
      const prior = readHbi<ReferenceManifest>(target.manifest).sources.find((item) => item.source_id === source.source_id);
      if (prior) return result(root, prior, prior.reason, true);
    } catch { /* persist() returns the actionable corruption error */ }
  }
  return result(root, source, reason);
}
