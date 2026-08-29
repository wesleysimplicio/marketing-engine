import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parsePolicy, renderReport, runPolicyCli, scanInternalFormats, sourceUsesJson, validateRegistry } from "../../lib/policy/internal-formats.mjs";

const valid = (pattern = "state.toml") => ({ pattern, category: "toolchain_mandated", owner: "quality", reason: "required by tool", review: "2099-01-01", target_format: "TOML" });

test("parses exact TOML path records", () => {
  const records = parsePolicy('version = 2\n[[paths]]\npattern = "a.json"\nowner = "quality"');
  assert.deepEqual(records, [{ pattern: "a.json", owner: "quality" }]);
});

test("registry rejects globs, omissions, duplicates, invalid and expired reviews", () => {
  const errors = validateRegistry([
    { ...valid("data/**"), reason: "", review: "bad" },
    { ...valid("data/**"), review: "2020-01-01" },
  ], new Date("2026-07-22T00:00:00Z"));
  assert.ok(errors.some((x) => x.includes("exact paths")));
  assert.ok(errors.some((x) => x.includes("missing reason")));
  assert.ok(errors.some((x) => x.includes("duplicate")));
  assert.ok(errors.some((x) => x.includes("YYYY-MM-DD")));
  assert.ok(errors.some((x) => x.includes("expired")));
});

test("allows an explicit directory boundary while exact migration paths win", () => {
  const directory = { ...valid("data/**"), scope: "directory" };
  assert.deepEqual(validateRegistry([directory]), []);
  const root = mkdtempSync(join(tmpdir(), "format-policy-scoped-"));
  mkdirSync(join(root, "config"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "config", "json-boundaries.toml"), [
    "version = 2",
    "[[paths]]", 'pattern = "data/**"', 'scope = "directory"', 'category = "test_fixture"', 'owner = "quality"',
    'reason = "bounded public fixture directory"', 'review = "2099-01-01"', 'target_format = "JSON fixture"',
    "[[paths]]", 'pattern = "data/internal.json"', 'category = "internal_persistence"', 'owner = "quality"',
    'reason = "legacy migration input"', 'review = "2099-01-01"', 'target_format = "HBP"',
  ].join("\n"));
  writeFileSync(join(root, "data", "public.json"), "{}");
  writeFileSync(join(root, "data", "internal.json"), "{}");
  const report = scanInternalFormats({ root, strict: true });
  assert.deepEqual(report.unknown, []);
  assert.deepEqual(report.bounded.map((x) => x.path), ["data/public.json"]);
  assert.deepEqual(report.migration.map((x) => x.path), ["data/internal.json"]);
});

test("recognizes serializers without flagging ordinary JSON words", () => {
  assert.equal(sourceUsesJson("const value = JSON.parse(raw)"), true);
  assert.equal(sourceUsesJson("const format = 'json'"), false);
});

test("scan fails closed on unclassified source and generated artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "format-policy-"));
  const generated = mkdtempSync(join(tmpdir(), "format-output-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "json-boundaries.toml"), "version = 2\n");
  writeFileSync(join(root, "state.ts"), "JSON.stringify({ secret: false })");
  writeFileSync(join(generated, "leak.json"), "{}");
  const report = scanInternalFormats({ root, extraRoots: [generated] });
  assert.deepEqual(report.unknown.map((x) => x.path).sort(), ["@generated/leak.json", "state.ts"]);
});

test("strict mode distinguishes classified migration work from exceptions", () => {
  const root = mkdtempSync(join(tmpdir(), "format-policy-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "json-boundaries.toml"), [
    "[[paths]]", 'pattern = "state.json"', 'category = "internal_persistence"', 'owner = "quality"',
    'reason = "legacy migration input"', 'review = "2099-01-01"', 'target_format = "HBP"',
  ].join("\n"));
  writeFileSync(join(root, "state.json"), "{}");
  const report = scanInternalFormats({ root, strict: true });
  assert.equal(report.mode, "strict");
  assert.equal(report.migration.length, 1);
  assert.equal(report.unknown.length, 0);
  assert.match(renderReport(report), /## Unclassified\n- none/);
});

test("CLI returns zero for a clean root and prints Markdown", () => {
  const root = mkdtempSync(join(tmpdir(), "format-policy-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "json-boundaries.toml"), "version = 2\n");
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string) => { output += chunk; return true; }) as typeof process.stdout.write;
  try { assert.equal(runPolicyCli(["--root", root], {}), 0); }
  finally { process.stdout.write = original; }
  assert.match(output, /Mode: baseline/);
});
