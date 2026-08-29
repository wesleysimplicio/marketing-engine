import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendSavingsEvent, legacyMarketingLedgerPath, marketingLedgerPath, savingsSummary, verifyChain } from "../../lib/observability/savings";
import { readHbp } from "../../lib/formats/binary";

test("marketing savings ledger uses HBP and preserves hash-chain verification", () => {
  const root = mkdtempSync(join(tmpdir(), "marketing-savings-"));
  const first = appendSavingsEvent(root, { source: "loop:reuse", surfaces: ["cache"], tokens: { baseline_total: 40, actual_total: 10 }, methodology: "fixture" });
  const second = appendSavingsEvent(root, { source: "loop:reuse", surfaces: ["cache"], tokens: { baseline_total: 20, actual_total: 5 }, methodology: "fixture" });
  assert.ok(first && second);
  assert.equal(existsSync(marketingLedgerPath(root)), true);
  assert.equal(existsSync(legacyMarketingLedgerPath(root)), false);
  assert.deepEqual(verifyChain(root), { ok: true, count: 2 });
  assert.equal(readHbp(marketingLedgerPath(root)).length, 2);
  assert.equal(savingsSummary(root).saved_total, 45);
});

test("legacy marketing JSONL is migrated once and retained as a backup", () => {
  const root = mkdtempSync(join(tmpdir(), "marketing-savings-legacy-"));
  const ledgerDir = join(root, ".simplicio", "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  const body = { schema: "simplicio.savings-event/v1", event_id: "legacy", ts: new Date().toISOString(), source: "legacy", estimator: "heuristic:chars-div-4", surfaces: ["cache"], tokens: { baseline_total: 4, actual_total: 2, saved_total: 2, pct_saved: 50 }, proof: { kind: "estimated", methodology: "fixture" }, prev_event_hash: null, event_hash: "legacy-hash" };
  writeFileSync(legacyMarketingLedgerPath(root), `${JSON.stringify(body)}\n`);
  const summary = savingsSummary(root);
  assert.equal(summary.count, 1);
  assert.equal(existsSync(marketingLedgerPath(root)), true);
  assert.equal(existsSync(`${legacyMarketingLedgerPath(root)}.bak`), true);
});
