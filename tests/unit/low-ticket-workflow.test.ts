import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHbp, readHbi } from "../../lib/formats/binary";
import { lowTicketPaths, persistLowTicketPlan, planLowTicket, type LowTicketInput } from "../../lib/low-ticket/workflow";

const baseInput: LowTicketInput = {
  campaign_id: "camp-pt-001",
  objective: "validar uma oferta de entrada",
  market: "software para pequenas empresas",
  currency: "BRL",
  total_budget_usd: 100,
  max_daily_budget_usd: 25,
  reference_source_id: "ref-authorized",
  transcript_segment_count: 3,
  transcript_complete: true,
  evidence: [{ evidence_id: "ev-1", kind: "fact", claim: "entrevista fornecida pelo operador", source_id: "ref-authorized", source_uri: null, observed_at: "2026-08-01", confidence: null }],
  economics: { price_usd: 49, cogs_usd: 5, payment_fee_rate: 0.05, refund_rate: 0.02, tax_rate: 0.06, support_cost_usd: 2 },
  angles: ["tempo", "clareza"],
  hooks: ["demonstração", "problema"],
  now: "2026-08-29T00:00:00.000Z",
};

test("low-ticket plan exposes the full canonical lifecycle and stays dry-run", () => {
  const plan = planLowTicket(baseInput);
  assert.equal(plan.schema, "marketing-low-ticket-plan/v1");
  assert.equal(plan.dry_run, true);
  assert.equal(plan.stages.length, 20);
  assert.deepEqual(plan.stages.map((item) => item.stage), [
    "reference-intake", "transcript-timeline", "business-constraints", "market-research", "opportunity-score",
    "icp-jtbd", "offer-architecture", "unit-economics", "funnel-architecture", "asset-production", "compliance-qa",
    "tracking-validation", "launch-plan", "controlled-test", "observation", "diagnosis", "iteration", "winner-promotion", "scaling", "reporting-postmortem",
  ]);
  assert.equal(plan.stages[0]?.status, "planned");
  assert.equal(plan.stages[2]?.status, "ready");
  assert.equal(plan.stages[11]?.status, "blocked");
  assert.equal(plan.gates.publish, "blocked");
  assert.equal(plan.asset_matrix.combinations, 4);
  assert.equal(plan.economics.break_even_cpa_usd, 35.63);
  assert.equal(plan.economics.break_even_roas, 1.3752);
  assert.ok(plan.opportunity.heuristic_score !== null);
  assert.ok(plan.metrics.every((metric) => metric.value === null && metric.reason === "not-observed"));
});

test("missing evidence and unsafe budget caps fail closed without invented economics", () => {
  const plan = planLowTicket({ ...baseInput, total_budget_usd: 10, max_daily_budget_usd: 20, evidence: [], economics: undefined });
  assert.equal(plan.gates.budget, "blocked");
  assert.equal(plan.gates.evidence, "blocked");
  assert.equal(plan.opportunity.heuristic_score, null);
  assert.equal(plan.opportunity.reason, "no-supplied-evidence");
  assert.equal(plan.economics.contribution_before_ads_usd, null);
  assert.match(plan.economics.reason ?? "", /missing-economics-input/);
  assert.equal(plan.stages.find((stage) => stage.stage === "market-research")?.status, "blocked");
  assert.equal(plan.stages.find((stage) => stage.stage === "reporting-postmortem")?.status, "blocked");
});

test("plans persist as HBI and stage receipts are idempotent HBP records", () => {
  const root = mkdtempSync(join(tmpdir(), "low-ticket-workflow-"));
  const plan = planLowTicket(baseInput);
  persistLowTicketPlan(root, plan);
  persistLowTicketPlan(root, plan);
  const paths = lowTicketPaths(root, plan.plan_id);
  assert.equal(existsSync(paths.plan), true);
  assert.equal(readHbi<{ plan: { plan_id: string } }>(paths.plan).plan.plan_id, plan.plan_id);
  assert.equal(readHbp(paths.receipts).length, plan.stages.length);
});
