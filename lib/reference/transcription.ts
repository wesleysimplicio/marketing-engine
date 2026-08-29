import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendHbp, readHbi, readHbp, writeHbiAtomic } from "../formats/binary";
import type { ReferenceSource } from "./ingest";

export const TRANSCRIPTION_SCHEMA = "marketing-transcription/v1" as const;
export const TRANSCRIPTION_RECEIPT_SCHEMA = "marketing-transcription-receipt/v1" as const;
export const TRANSCRIPTION_CACHE_SCHEMA = "marketing-transcription-cache/v1" as const;

export type PrivacyClass = "local" | "no_retention" | "external";
export type CostClass = "free" | "low" | "medium" | "high";
export type TranscriptOrigin = "provider" | "supplied_transcript" | "manual_review";
export type TranscriptionStatus = "completed" | "cached" | "partial" | "deferred" | "manual_review" | "rejected";

export interface TranscriptSegment {
  segment_id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  language: string;
  confidence: number | null;
  speaker: string | null;
  origin: TranscriptOrigin;
}

export interface ProviderSegment {
  segment_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  text: string;
  language?: string;
  confidence?: number | null;
  speaker?: string | null;
}

export interface ProviderInput {
  source: ReferenceSource;
  language: string;
  segments: Array<Pick<TranscriptSegment, "segment_id" | "start_seconds" | "end_seconds" | "text">>;
  dry_run: boolean;
}

export interface ProviderOutput {
  segments: ProviderSegment[];
  cost_usd?: number | null;
  latency_ms?: number | null;
}

export interface TranscriptionProvider {
  id: string;
  version: string;
  languages: string[];
  max_duration_seconds: number | null;
  cost_class: CostClass;
  privacy: PrivacyClass;
  transcribe(input: ProviderInput): Promise<ProviderOutput>;
}

export interface LanguageDetection {
  language: string | null;
  confidence: number;
  requires_manual_review: boolean;
  reason: string | null;
}

export interface TranscriptionRequest {
  source: ReferenceSource;
  text?: string;
  language?: string;
  provider?: string;
  privacy?: PrivacyClass;
  max_segment_chars?: number;
  dry_run?: boolean;
  root?: string;
  allow_manual_review?: boolean;
}

export interface TranscriptionReceipt {
  schema: typeof TRANSCRIPTION_RECEIPT_SCHEMA;
  receipt_id: string;
  transcription_id: string;
  source_id: string;
  status: TranscriptionStatus;
  provider_id: string | null;
  provider_version: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  confidence: number | null;
  segment_count: number;
  cached_segment_count: number;
  resumed_segment_count: number;
  language: string | null;
  reason: string | null;
  created_at: string;
}

export interface TranscriptionResult {
  schema: typeof TRANSCRIPTION_SCHEMA;
  transcription_id: string;
  source_id: string;
  status: TranscriptionStatus;
  language: string | null;
  detection: LanguageDetection | null;
  provider_id: string | null;
  provider_version: string | null;
  segments: TranscriptSegment[];
  complete: boolean;
  cached: boolean;
  resumed: boolean;
  reason: string | null;
  receipt: TranscriptionReceipt;
  cache_key: string;
}

interface CacheEntry {
  cache_key: string;
  source_id: string;
  provider_id: string;
  provider_version: string;
  language: string;
  segments: TranscriptSegment[];
  updated_at: string;
}

interface TranscriptionCache {
  schema: typeof TRANSCRIPTION_CACHE_SCHEMA;
  entries: CacheEntry[];
}

const COST_RANK: Record<CostClass, number> = { free: 0, low: 1, medium: 2, high: 3 };
const PRIVACY_RANK: Record<PrivacyClass, number> = { local: 0, no_retention: 1, external: 2 };
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const now = (): string => new Date().toISOString();
const defaultDryRun = (): boolean => process.env.DRY_RUN !== "false";

function stable(value: unknown): string { return JSON.stringify(value); }

function referencePaths(root: string): { dir: string; cache: string; receipts: string } {
  const dir = resolve(root, "data", "references");
  return { dir, cache: resolve(dir, "transcription-cache.hbi"), receipts: resolve(dir, "transcription-receipts.hbp") };
}

function languageMatches(provider: TranscriptionProvider, language: string): boolean {
  if (provider.languages.includes("*")) return true;
  const base = language.toLowerCase().split("-")[0];
  return provider.languages.some((item) => item.toLowerCase() === language.toLowerCase() || item.toLowerCase() === base);
}

function privacyAllowed(provider: TranscriptionProvider, requested?: PrivacyClass): boolean {
  return requested === undefined || PRIVACY_RANK[provider.privacy] <= PRIVACY_RANK[requested];
}

function normaliseLanguage(language: string): string { return language.trim().replace("_", "-"); }

/** Conservative language hinting. Ambiguous text is intentionally sent to review. */
export function detectLanguage(text: string): LanguageDetection {
  const value = text.toLowerCase();
  if (!value.trim()) return { language: null, confidence: 0, requires_manual_review: true, reason: "empty-text" };
  const pt = (value.match(/\b(que|para|com|uma|não|não|você|como|dos|das|este|isso|são)\b/g) ?? []).length;
  const en = (value.match(/\b(the|and|for|with|this|that|you|are|from|your|not)\b/g) ?? []).length;
  if (pt === 0 && en === 0) return { language: null, confidence: 0.25, requires_manual_review: true, reason: "insufficient-language-signal" };
  if (pt === en) return { language: null, confidence: 0.5, requires_manual_review: true, reason: "ambiguous-language-signal" };
  const language = pt > en ? "pt" : "en";
  const confidence = Math.min(0.99, 0.55 + Math.abs(pt - en) * 0.08);
  return { language, confidence, requires_manual_review: confidence < 0.7, reason: confidence < 0.7 ? "low-confidence-language-signal" : null };
}

function splitAtBoundary(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < Math.floor(maxChars * 0.5)) cut = remaining.indexOf(" ", maxChars);
    if (cut <= 0) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Split long text into contiguous, non-overlapping timeline windows. */
export function segmentTranscript(text: string, options: {
  source_id?: string;
  language?: string;
  duration_seconds?: number | null;
  max_segment_chars?: number;
} = {}): TranscriptSegment[] {
  const maxChars = Math.max(80, Math.floor(options.max_segment_chars ?? 900));
  const chunks = splitAtBoundary(text, maxChars);
  const effectiveDuration = options.duration_seconds && options.duration_seconds > 0 ? options.duration_seconds : chunks.length;
  const window = chunks.length ? effectiveDuration / chunks.length : 0;
  const language = options.language ?? "und";
  return chunks.map((chunk, index) => ({
    segment_id: `seg-${sha256(`${options.source_id ?? "source"}:${index}:${chunk}`).slice(0, 20)}`,
    start_seconds: Number((index * window).toFixed(3)),
    end_seconds: Number(((index + 1) * window).toFixed(3)),
    text: chunk,
    language,
    confidence: null,
    speaker: null,
    origin: "provider" as const,
  }));
}

/** Recombine only a complete, ordered, non-overlapping timeline. */
export function recombineSegments(segments: TranscriptSegment[]): string {
  const ordered = [...segments].sort((a, b) => a.start_seconds - b.start_seconds || a.segment_id.localeCompare(b.segment_id));
  let previousEnd = 0;
  for (const segment of ordered) {
    if (segment.start_seconds < previousEnd) throw new Error(`transcript-segment-overlap:${segment.segment_id}`);
    if (segment.end_seconds < segment.start_seconds) throw new Error(`transcript-segment-reversed:${segment.segment_id}`);
    previousEnd = segment.end_seconds;
  }
  return ordered.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
}

function readCache(path: string): TranscriptionCache {
  if (!existsSync(path)) return { schema: TRANSCRIPTION_CACHE_SCHEMA, entries: [] };
  const value = readHbi<TranscriptionCache>(path);
  if (value.schema !== TRANSCRIPTION_CACHE_SCHEMA || !Array.isArray(value.entries)) throw new Error("transcription-cache-corrupt");
  return value;
}

function writeCache(path: string, cache: TranscriptionCache): void {
  cache.entries.sort((a, b) => a.cache_key.localeCompare(b.cache_key));
  writeHbiAtomic(path, cache);
}

function appendReceipt(path: string, receipt: TranscriptionReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  const prior = existsSync(path) ? readHbp<TranscriptionReceipt>(path) : [];
  if (!prior.some((item) => item.receipt_id === receipt.receipt_id)) appendHbp(path, receipt);
}

function averageConfidence(segments: TranscriptSegment[]): number | null {
  const values = segments.map((item) => item.confidence).filter((item): item is number => typeof item === "number");
  return values.length ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(4)) : null;
}

function makeReceipt(input: {
  transcription_id: string;
  source_id: string;
  status: TranscriptionStatus;
  provider: TranscriptionProvider | null;
  cost_usd: number | null;
  latency_ms: number | null;
  confidence: number | null;
  segment_count: number;
  cached_segment_count: number;
  resumed_segment_count: number;
  language: string | null;
  reason: string | null;
}): TranscriptionReceipt {
  return {
    schema: TRANSCRIPTION_RECEIPT_SCHEMA,
    receipt_id: `transcription:${input.transcription_id}:${input.status}`,
    transcription_id: input.transcription_id,
    source_id: input.source_id,
    status: input.status,
    provider_id: input.provider?.id ?? null,
    provider_version: input.provider?.version ?? null,
    cost_usd: input.cost_usd,
    latency_ms: input.latency_ms,
    confidence: input.confidence,
    segment_count: input.segment_count,
    cached_segment_count: input.cached_segment_count,
    resumed_segment_count: input.resumed_segment_count,
    language: input.language,
    reason: input.reason,
    created_at: now(),
  };
}

export interface RouterOptions { failure_threshold?: number; }

/** Provider-neutral router. Providers are injected so dry-run tests never need network access. */
export class TranscriptionRouter {
  private readonly failures = new Map<string, number>();
  private readonly providers: TranscriptionProvider[];
  private readonly failureThreshold: number;

  constructor(providers: TranscriptionProvider[], options: RouterOptions = {}) {
    this.providers = [...providers];
    this.failureThreshold = Math.max(1, options.failure_threshold ?? 2);
  }

  isCircuitOpen(providerId: string): boolean { return (this.failures.get(providerId) ?? 0) >= this.failureThreshold; }

  private eligible(request: TranscriptionRequest, language: string): TranscriptionProvider[] {
    const duration = request.source.duration_seconds;
    return this.providers
      .filter((provider) => !this.isCircuitOpen(provider.id))
      .filter((provider) => request.provider === undefined || provider.id === request.provider)
      .filter((provider) => languageMatches(provider, language))
      .filter((provider) => privacyAllowed(provider, request.privacy))
      .filter((provider) => provider.max_duration_seconds === null || duration === null || duration <= provider.max_duration_seconds)
      .sort((a, b) => COST_RANK[a.cost_class] - COST_RANK[b.cost_class] || PRIVACY_RANK[a.privacy] - PRIVACY_RANK[b.privacy] || a.id.localeCompare(b.id));
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const root = resolve(request.root ?? process.cwd());
    const paths = referencePaths(root);
    const text = request.text?.trim() ?? "";
    const detection = request.language ? null : detectLanguage(text);
    const language = request.language ? normaliseLanguage(request.language) : detection?.language;
    const baseId = sha256(stable({ source_id: request.source.source_id, text, language: language ?? null, max_segment_chars: request.max_segment_chars ?? 900 }));
    const emptyReceipt = (status: TranscriptionStatus, reason: string, provider: TranscriptionProvider | null = null, segmentCount = 0): TranscriptionResult => {
      const receipt = makeReceipt({ transcription_id: baseId, source_id: request.source.source_id, status, provider, cost_usd: null, latency_ms: null, confidence: null, segment_count: segmentCount, cached_segment_count: 0, resumed_segment_count: 0, language: language ?? null, reason });
      appendReceipt(paths.receipts, receipt);
      return { schema: TRANSCRIPTION_SCHEMA, transcription_id: baseId, source_id: request.source.source_id, status, language: language ?? null, detection, provider_id: provider?.id ?? null, provider_version: provider?.version ?? null, segments: [], complete: false, cached: false, resumed: false, reason, receipt, cache_key: baseId };
    };

    if (request.source.status !== "ingested") return emptyReceipt("deferred", `source-not-ready:${request.source.reason ?? request.source.status}`);
    if (request.source.permissions === "denied") return emptyReceipt("rejected", "permissions-denied");
    if (!text) return emptyReceipt("rejected", "transcription-text-required");
    if (!language) return emptyReceipt("manual_review", detection?.reason ?? "language-review-required");
    if (detection?.requires_manual_review && !request.language && !request.allow_manual_review) return emptyReceipt("manual_review", detection.reason ?? "language-review-required");

    const planned = segmentTranscript(text, { source_id: request.source.source_id, language, duration_seconds: request.source.duration_seconds, max_segment_chars: request.max_segment_chars });
    const providers = this.eligible(request, language);
    if (!providers.length) return emptyReceipt(this.isCircuitOpen(request.provider ?? "") ? "rejected" : "deferred", request.provider ? `provider-unavailable:${request.provider}` : "no-compatible-provider", null, planned.length);

    const cache = readCache(paths.cache);
    let selected: TranscriptionProvider | null = null;
    let cacheKey = "";
    let cachedSegments: TranscriptSegment[] = [];
    for (const provider of providers) {
      const key = sha256(stable({ baseId, provider: provider.id, version: provider.version }));
      const entry = cache.entries.find((item) => item.cache_key === key);
      if (entry) {
        selected = provider;
        cacheKey = key;
        cachedSegments = entry.segments.filter((segment) => planned.some((item) => item.segment_id === segment.segment_id));
        if (cachedSegments.length === planned.length) break;
      } else if (!selected) {
        selected = provider;
        cacheKey = key;
      }
    }
    if (!selected) return emptyReceipt("deferred", "no-compatible-provider", null, planned.length);
    const pending = planned.filter((item) => !cachedSegments.some((cached) => cached.segment_id === item.segment_id));
    const cachedCount = cachedSegments.length;
    if (!pending.length) {
      const receipt = makeReceipt({ transcription_id: baseId, source_id: request.source.source_id, status: "cached", provider: selected, cost_usd: 0, latency_ms: 0, confidence: averageConfidence(cachedSegments), segment_count: cachedSegments.length, cached_segment_count: cachedCount, resumed_segment_count: 0, language, reason: null });
      appendReceipt(paths.receipts, receipt);
      return { schema: TRANSCRIPTION_SCHEMA, transcription_id: baseId, source_id: request.source.source_id, status: "cached", language, detection, provider_id: selected.id, provider_version: selected.version, segments: cachedSegments.sort((a, b) => a.start_seconds - b.start_seconds), complete: true, cached: true, resumed: false, reason: null, receipt, cache_key: cacheKey };
    }

    const started = Date.now();
    let output: ProviderOutput | null = null;
    let outputProvider = selected;
    const errors: string[] = [];
    for (const provider of providers) {
      const providerKey = sha256(stable({ baseId, provider: provider.id, version: provider.version }));
      if (providerKey !== cacheKey && cachedSegments.length) continue;
      try {
        output = await provider.transcribe({ source: request.source, language, segments: pending, dry_run: request.dry_run ?? defaultDryRun() });
        this.failures.delete(provider.id);
        outputProvider = provider;
        cacheKey = providerKey;
        break;
      } catch (error) {
        const count = (this.failures.get(provider.id) ?? 0) + 1;
        this.failures.set(provider.id, count);
        errors.push(`${provider.id}:${error instanceof Error ? error.message : String(error)}`);
        if (this.isCircuitOpen(provider.id)) errors.push(`${provider.id}:circuit-open`);
      }
    }
    if (!output) return emptyReceipt("rejected", errors.join(";") || "all-providers-failed", selected, planned.length);

    const byId = new Map(output.segments.map((segment) => [segment.segment_id, segment]));
    const fresh: TranscriptSegment[] = [];
    for (const item of pending) {
      const supplied = byId.get(item.segment_id) ?? output.segments[pending.indexOf(item)];
      if (!supplied?.text?.trim()) continue;
      fresh.push({
        segment_id: item.segment_id,
        start_seconds: item.start_seconds,
        end_seconds: item.end_seconds,
        text: supplied.text.trim(),
        language: supplied.language ? normaliseLanguage(supplied.language) : language,
        confidence: typeof supplied.confidence === "number" ? Math.max(0, Math.min(1, supplied.confidence)) : null,
        speaker: supplied.speaker ?? null,
        origin: "provider",
      });
    }
    const allSegments = [...cachedSegments, ...fresh].sort((a, b) => a.start_seconds - b.start_seconds);
    const complete = allSegments.length === planned.length;
    if (allSegments.length) {
      const entry: CacheEntry = { cache_key: cacheKey, source_id: request.source.source_id, provider_id: outputProvider.id, provider_version: outputProvider.version, language, segments: allSegments, updated_at: now() };
      const existingIndex = cache.entries.findIndex((item) => item.cache_key === cacheKey);
      if (existingIndex >= 0) cache.entries[existingIndex] = entry;
      else cache.entries.push(entry);
      mkdirSync(paths.dir, { recursive: true });
      writeCache(paths.cache, cache);
    }
    const status: TranscriptionStatus = complete ? "completed" : "partial";
    const reason = complete ? null : "segments-pending-resume";
    const receipt = makeReceipt({ transcription_id: baseId, source_id: request.source.source_id, status, provider: outputProvider, cost_usd: output.cost_usd ?? null, latency_ms: output.latency_ms ?? Date.now() - started, confidence: averageConfidence(allSegments), segment_count: allSegments.length, cached_segment_count: cachedCount, resumed_segment_count: cachedCount, language, reason });
    appendReceipt(paths.receipts, receipt);
    return { schema: TRANSCRIPTION_SCHEMA, transcription_id: baseId, source_id: request.source.source_id, status, language, detection, provider_id: outputProvider.id, provider_version: outputProvider.version, segments: allSegments, complete, cached: false, resumed: cachedCount > 0, reason, receipt, cache_key: cacheKey };
  }
}

export function suppliedTranscriptProvider(): TranscriptionProvider {
  return {
    id: "supplied-transcript",
    version: "1.0.0",
    languages: ["*"],
    max_duration_seconds: null,
    cost_class: "free",
    privacy: "local",
    async transcribe(input) {
      return { segments: input.segments.map((segment) => ({ segment_id: segment.segment_id, text: segment.text, confidence: 1, language: input.language })) , cost_usd: 0, latency_ms: 0 };
    },
  };
}
