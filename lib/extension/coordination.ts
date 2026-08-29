import { createHash } from "node:crypto";

export type CoreDecision = "OWN" | "CONTINUE" | "DEFER" | "RECLAIM" | "VERIFY_PARTIAL";
export type ClaimUnitType = "campaign" | "piece" | "creative" | "target";

export interface ClaimUnit {
  unit_id: string;
  unit_type: ClaimUnitType;
  stage_id: string;
  depends_on?: string[];
}

export interface CoreClaim {
  authority: "loop-core";
  decision: CoreDecision;
  unit: ClaimUnit;
  lease_ref: string;
  fence_token: string;
}

export interface DelegatedStage {
  stage_id: string;
  handler: string;
  depends_on: string[];
  candidate_only: boolean;
  resource_class: string;
}

export interface EffectIntent {
  effect_id: "publish" | "ads" | "comments";
  intent_id: string;
  idempotency_key: string;
  requires_core_authorization: true;
  requires_confirmation: true;
  dry_run: boolean;
}

export interface CoordinationPlan {
  schema: "loop.marketing/core-delegation/v1";
  run_id: string;
  tenant_id: string;
  claim: CoreClaim;
  stages: DelegatedStage[];
  effects: EffectIntent[];
  plan_hash: string;
}

export interface CoordinationInput {
  run_id: string;
  tenant_id: string;
  lease_ref: string;
  fence_token: string;
  decision: CoreDecision;
  claim_units: ClaimUnit[];
  stages: DelegatedStage[];
  effects?: Array<{ effect_id: EffectIntent["effect_id"]; intent_id: string }>;
  dry_run?: boolean;
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label}-required`);
}

/**
 * Builds only the extension's delegation envelope. Core owns claims, queues,
 * leases, fences, retries, stage scheduling and effect execution.
 */
export function buildCoordinationPlan(input: CoordinationInput): CoordinationPlan {
  requireText(input.run_id, "run-id");
  requireText(input.tenant_id, "tenant-id");
  requireText(input.lease_ref, "lease-ref");
  requireText(input.fence_token, "fence-token");
  if (!input.claim_units.length) throw new Error("claim-unit-required");
  const units = [...input.claim_units].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  if (new Set(units.map((unit) => unit.unit_id)).size !== units.length) throw new Error("duplicate-claim-unit");
  const stages = [...input.stages].map((stage) => ({ ...stage, depends_on: [...stage.depends_on].sort() })).sort((a, b) => a.stage_id.localeCompare(b.stage_id));
  const knownStages = new Set(stages.map((stage) => stage.stage_id));
  for (const stage of stages) for (const dependency of stage.depends_on) if (!knownStages.has(dependency)) throw new Error(`unknown-stage-dependency:${dependency}`);
  const unit = units[0]!;
  const effects = (input.effects ?? []).map((effect) => ({
    effect_id: effect.effect_id,
    intent_id: effect.intent_id,
    idempotency_key: `${input.tenant_id}:${input.run_id}:${effect.effect_id}:${effect.intent_id}`,
    requires_core_authorization: true as const,
    requires_confirmation: true as const,
    dry_run: input.dry_run !== false,
  })).sort((a, b) => a.intent_id.localeCompare(b.intent_id));
  const claim: CoreClaim = { authority: "loop-core", decision: input.decision, unit, lease_ref: input.lease_ref, fence_token: input.fence_token };
  const unsigned = { schema: "loop.marketing/core-delegation/v1" as const, run_id: input.run_id, tenant_id: input.tenant_id, claim, stages, effects };
  return { ...unsigned, plan_hash: hash(unsigned) };
}

export function decideClaim(input: { active: boolean; stale: boolean; completed: boolean; evidence_complete: boolean }): CoreDecision {
  if (input.stale) return "RECLAIM";
  if (input.completed && input.evidence_complete) return "VERIFY_PARTIAL";
  if (!input.active) return "DEFER";
  return "CONTINUE";
}

export function stopCleanup(plan: CoordinationPlan): { revoke_fence: string; cancel_candidate_stages: string[]; reconcile_effects: string[] } {
  return {
    revoke_fence: plan.claim.fence_token,
    cancel_candidate_stages: plan.stages.filter((stage) => stage.candidate_only).map((stage) => stage.stage_id),
    reconcile_effects: plan.effects.map((effect) => effect.idempotency_key),
  };
}
