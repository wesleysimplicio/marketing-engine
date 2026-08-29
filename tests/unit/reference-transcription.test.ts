import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ReferenceSource } from "../../lib/reference/ingest";
import { detectLanguage, recombineSegments, segmentTranscript, suppliedTranscriptProvider, TranscriptionRouter, type ProviderInput, type TranscriptionProvider } from "../../lib/reference/transcription";

function source(id = "ref-test"): ReferenceSource {
  return {
    schema: "marketing-reference-source/v1",
    source_id: id,
    kind: "transcript",
    origin: "supplied_transcript",
    canonical_uri: "supplied-transcript",
    content_sha256: "source-hash",
    language: null,
    duration_seconds: 12,
    permissions: "granted",
    collected_at: "2026-01-01T00:00:00.000Z",
    status: "ingested",
    reason: null,
    idempotency_key: id,
  };
}

function root(prefix: string): string { return mkdtempSync(join(tmpdir(), `marketing-${prefix}-`)); }

function provider(id: string, overrides: Partial<TranscriptionProvider> = {}): TranscriptionProvider {
  return {
    id,
    version: "1.0.0",
    languages: ["pt-BR"],
    max_duration_seconds: null,
    cost_class: "low",
    privacy: "local",
    async transcribe(input: ProviderInput) {
      return { segments: input.segments.map((item) => ({ segment_id: item.segment_id, text: item.text, language: input.language, confidence: 0.91 })), cost_usd: 0.01, latency_ms: 7 };
    },
    ...overrides,
  };
}

test("language detection is conservative and manual language overrides are available", () => {
  const detected = detectLanguage("Você pode usar isso para uma campanha com uma oferta");
  assert.equal(detected.language, "pt");
  assert.equal(detected.requires_manual_review, false);
  assert.equal(detectLanguage("hello world").requires_manual_review, true);
});

test("long transcripts split and recombine without timeline overlap", () => {
  const text = Array.from({ length: 90 }, (_, index) => `palavra${index}`).join(" ");
  const segments = segmentTranscript(text, { source_id: "ref-long", language: "pt-BR", duration_seconds: 90, max_segment_chars: 100 });
  assert.ok(segments.length > 1);
  for (let index = 1; index < segments.length; index += 1) assert.ok(segments[index]!.start_seconds >= segments[index - 1]!.end_seconds);
  assert.equal(recombineSegments(segments), text);
  assert.throws(() => recombineSegments([segments[0]!, { ...segments[1]!, start_seconds: segments[0]!.end_seconds - 0.1 }]), /overlap/);
});

test("provider matrix chooses a language/privacy-compatible low-cost provider", async () => {
  const calls: string[] = [];
  const expensive = provider("expensive", { cost_class: "high", privacy: "no_retention", transcribe: async (input) => { calls.push("expensive"); return { segments: input.segments.map((item) => ({ segment_id: item.segment_id, text: item.text })) }; } });
  const cheap = provider("cheap", { cost_class: "low", transcribe: async (input) => { calls.push("cheap"); return { segments: input.segments.map((item) => ({ segment_id: item.segment_id, text: item.text })) }; } });
  const result = await new TranscriptionRouter([expensive, cheap]).transcribe({ source: source(), text: "Você pode usar isso para uma campanha", language: "pt-BR", privacy: "local", root: root("matrix") });
  assert.equal(result.status, "completed");
  assert.equal(result.provider_id, "cheap");
  assert.deepEqual(calls, ["cheap"]);
  assert.equal(result.receipt.cost_usd, null);
});

test("provider failure falls back and opens a circuit after the threshold", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = provider("primary", { cost_class: "free", transcribe: async () => { primaryCalls += 1; throw new Error("provider-down"); } });
  const fallback = provider("fallback", { cost_class: "low", transcribe: async (input) => { fallbackCalls += 1; return { segments: input.segments.map((item) => ({ segment_id: item.segment_id, text: item.text })) }; } });
  const router = new TranscriptionRouter([primary, fallback]);
  const tempRoot = root("fallback");
  const first = await router.transcribe({ source: source("ref-one"), text: "Você pode usar isso", language: "pt-BR", root: tempRoot });
  const second = await router.transcribe({ source: source("ref-two"), text: "Você pode usar outra coisa", language: "pt-BR", root: tempRoot });
  assert.equal(first.provider_id, "fallback");
  assert.equal(second.provider_id, "fallback");
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 2);
  assert.equal(router.isCircuitOpen("primary"), true);
});

test("partial segment cache resumes only the missing segments", async () => {
  let calls = 0;
  const resumable = provider("resumable", { transcribe: async (input) => { calls += 1; const items = calls === 1 ? input.segments.slice(0, 1) : input.segments; return { segments: items.map((item) => ({ segment_id: item.segment_id, text: item.text, confidence: 0.8 })) }; } });
  const router = new TranscriptionRouter([resumable]);
  const request = { source: source("ref-resume"), text: Array.from({ length: 30 }, (_, index) => `termo${index}`).join(" "), language: "pt-BR", max_segment_chars: 80, root: root("resume") };
  const first = await router.transcribe(request);
  const second = await router.transcribe(request);
  assert.equal(first.status, "partial");
  assert.equal(first.complete, false);
  assert.equal(second.status, "completed");
  assert.equal(second.resumed, true);
  assert.equal(second.receipt.resumed_segment_count, 1);
  assert.equal(calls, 2);
});

test("the supplied transcript provider is local, deterministic, and free", async () => {
  const segments = segmentTranscript("uma oferta para você", { source_id: "ref-supplied", language: "pt-BR" });
  const result = await suppliedTranscriptProvider().transcribe({ source: source("ref-supplied"), language: "pt-BR", segments, dry_run: true });
  assert.equal(result.cost_usd, 0);
  assert.equal(result.segments[0]?.confidence, 1);
});
