import assert from "node:assert/strict";
import test from "node:test";
import { buildCoordinationPlan, decideClaim, stopCleanup } from "../../lib/extension/coordination";

const input = () => ({
  run_id: "run-1", tenant_id: "tenant-1", lease_ref: "lease-1", fence_token: "fence-1", decision: "OWN" as const,
  claim_units: [
    { unit_id: "piece-2", unit_type: "piece" as const, stage_id: "copy" },
    { unit_id: "piece-1", unit_type: "piece" as const, stage_id: "copy" },
  ],
  stages: [
    { stage_id: "creative", handler: "marketing.creative", depends_on: ["copy"], candidate_only: true, resource_class: "image_video" },
    { stage_id: "copy", handler: "marketing.copy", depends_on: [], candidate_only: true, resource_class: "llm" },
  ],
  effects: [{ effect_id: "publish" as const, intent_id: "piece-1" }],
});

test("delegation is deterministic and core-authoritative", () => {
  const a = buildCoordinationPlan(input());
  const b = buildCoordinationPlan({ ...input(), claim_units: [...input().claim_units].reverse(), stages: [...input().stages].reverse() });
  assert.deepEqual(a, b);
  assert.equal(a.claim.authority, "loop-core");
  assert.equal(a.effects[0]!.dry_run, true);
  assert.equal("scheduler" in a, false);
  assert.equal("queue" in a, false);
});

test("claim decisions and STOP cleanup remain declarative", () => {
  assert.equal(decideClaim({ active: true, stale: true, completed: false, evidence_complete: false }), "RECLAIM");
  assert.equal(decideClaim({ active: true, stale: false, completed: true, evidence_complete: true }), "VERIFY_PARTIAL");
  const plan = buildCoordinationPlan(input());
  assert.deepEqual(stopCleanup(plan), { revoke_fence: "fence-1", cancel_candidate_stages: ["copy", "creative"], reconcile_effects: ["tenant-1:run-1:publish:piece-1"] });
});

test("invalid dependencies and duplicate claims fail closed", () => {
  assert.throws(() => buildCoordinationPlan({ ...input(), claim_units: [...input().claim_units, input().claim_units[0]!] }), /duplicate-claim-unit/);
  assert.throws(() => buildCoordinationPlan({ ...input(), stages: [{ ...input().stages[0]!, depends_on: ["missing"] }] }), /unknown-stage-dependency/);
});
