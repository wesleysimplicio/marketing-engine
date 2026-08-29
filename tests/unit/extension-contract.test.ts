import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonicalJson, loadExtensionFiles, manifestHash, negotiateVersion, probeCapabilities } from "../../lib/extension/contract.ts";
import { composeStageGraph, CORE_STAGE_GRAPH, loadMarketingManifest } from "../../lib/extension/manifest.ts";

test("version negotiation is bounded and actionable", () => {
  assert.deepEqual(negotiateVersion("3.38.1", "3.38.0", "3.38.99"), { ok: true, reason_code: null });
  assert.equal(negotiateVersion("3.37.9", "3.38.0", "3.38.99").reason_code, "CORE_VERSION_TOO_OLD");
  assert.equal(negotiateVersion("3.39.0", "3.38.0", "3.38.99").reason_code, "CORE_VERSION_TOO_NEW");
  assert.equal(negotiateVersion("latest", "3.38.0", "3.38.99").reason_code, "EXT_VERSION_INVALID");
});

function fixtureRoot(output: object): string {
  const root = mkdtempSync(resolve(tmpdir(), "extension-probe-"));
  cpSync(resolve("extensions"), resolve(root, "extensions"), { recursive: true });
  const python = resolve(root, "python");
  writeFileSync(python, `#!/bin/sh\ncat >/dev/null\nprintf '%s' '${JSON.stringify(output)}'\n`);
  chmodSync(python, 0o755);
  process.env.PYTHON = python;
  return root;
}

test("capability probe accepts a compatible complete handshake and records pins", () => {
  const root = fixtureRoot({ ok: true, version: "3.38.1", capabilities: ["extension_manifest.validate", "extension_receipts.read", "extension_reconcile"] });
  const probe = probeCapabilities(root);
  assert.equal(probe.status, "DEGRADED");
  assert.equal(probe.reason_code, null);
  assert.equal(probe.core_version, "3.38.1");
  assert.equal(probe.manifest_sha256, loadExtensionFiles(root).hash);
});

test("capability probe blocks missing capability, incompatible version, invalid output and changed hash", () => {
  let root = fixtureRoot({ ok: true, version: "3.38.1", capabilities: ["extension_manifest.validate"] });
  assert.equal(probeCapabilities(root).reason_code, "REQUIRED_CAPABILITY_MISSING");
  root = fixtureRoot({ ok: true, version: "9.0.0", capabilities: ["extension_manifest.validate", "extension_receipts.read", "extension_reconcile"] });
  assert.equal(probeCapabilities(root).reason_code, "CORE_VERSION_TOO_NEW");
  root = fixtureRoot({ ok: true, version: "3.38.1", capabilities: [] });
  const lockPath = resolve(root, "extensions/loop.marketing/manifest.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8")); lock.manifest_sha256 = "changed"; writeFileSync(lockPath, JSON.stringify(lock));
  assert.equal(probeCapabilities(root).reason_code, "MANIFEST_HASH_MISMATCH");
  root = fixtureRoot("not-json");
  assert.equal(probeCapabilities(root).reason_code, "MANIFEST_REJECTED");
  delete process.env.PYTHON;
});

test("manifest hash is deterministic independent of object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  const manifest = JSON.parse(readFileSync(resolve("extensions/loop.marketing/manifest.json"), "utf8"));
  assert.match(manifestHash(manifest), /^[a-f0-9]{64}$/);
});

test("official marketing manifest composes with the core graph", () => {
  const manifest = loadMarketingManifest();
  const graph = composeStageGraph(CORE_STAGE_GRAPH, [manifest]);
  assert.equal(graph.ok, true, graph.errors.join("; "));
  assert.equal(manifest.role_bindings?.length, 14);
  assert.equal(manifest.stage_overlays?.length, 7);
});
