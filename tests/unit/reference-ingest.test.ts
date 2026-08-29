import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHbi, readHbp } from "../../lib/formats/binary";
import { ingestReference } from "../../lib/reference/ingest";

test("ingests supplied transcripts into a typed manifest and receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "reference-intake-"));
  const first = await ingestReference({ value: "asolarianote", supplied_transcript: "Olá, este é um roteiro real.", language: "pt-BR", root, dry_run: true });
  const second = await ingestReference({ value: "asolarianote", supplied_transcript: "Olá, este é um roteiro real.", language: "pt-BR", root, dry_run: true });
  assert.equal(first.source.status, "ingested");
  assert.equal(second.reused, true);
  assert.equal(readHbi<{ sources: unknown[] }>(first.manifest_path).sources.length, 1);
  assert.equal(readHbp(first.receipts_path).length, 1);
});

test("validates local files, size limits, and traversal before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "reference-file-"));
  mkdirSync(join(root, "refs"));
  writeFileSync(join(root, "refs", "sample.txt"), "reference");
  const accepted = await ingestReference({ value: "refs/sample.txt", root, max_bytes: 100 });
  assert.equal(accepted.source.status, "ingested");
  const traversal = await ingestReference({ value: "../outside.txt", root });
  assert.equal(traversal.source.reason, "path-outside-root");
  const tooLarge = await ingestReference({ value: "refs/sample.txt", root, max_bytes: 2 });
  assert.equal(tooLarge.source.reason, "file-too-large");
});

test("URL and YouTube intake is dry-run deferred, sanitized, and allowlist-aware", async () => {
  const root = await mkdtemp(join(tmpdir(), "reference-url-"));
  const deferred = await ingestReference({ value: "https://www.youtube.com/watch?v=abc123&utm_source=secret", root, dry_run: true });
  assert.equal(deferred.source.kind, "youtube");
  assert.equal(deferred.source.status, "deferred");
  assert.equal(deferred.source.canonical_uri, "https://www.youtube.com/watch?v=abc123");
  const denied = await ingestReference({ value: "https://example.com/video", root, allow_hosts: ["other.example"] });
  assert.equal(denied.source.reason, "host-not-allowlisted");
  assert.equal(existsSync(deferred.manifest_path), true);
});
