import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cleanRoot = mkdtempSync(resolve(tmpdir(), "format-policy-checkout-"));
cpSync(root, cleanRoot, {
  recursive: true,
  filter: (source) => !new Set([".git", "node_modules", "outputs", "coverage", "test-results", "playwright-report"]).has(source.split(/[\\/]/).at(-1) ?? ""),
});

test("baseline has no registry errors or unclassified internal JSON", () => {
  const result = spawnSync(process.execPath, ["scripts/check-internal-formats.mjs"], { cwd: cleanRoot, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("## Registry errors\n- none");
  expect(result.stdout).toContain("## Unclassified\n- none");
});

test("strict release gate is clean after the internal-state migration", () => {
  const result = spawnSync(process.execPath, ["scripts/check-internal-formats.mjs", "--strict"], { cwd: cleanRoot, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("## Migration required\n- none");
  expect(result.stdout).toContain("## Unclassified\n- none");
});
