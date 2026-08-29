import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { appendHbp, readHbp, writeHbiAtomic } from "../formats/binary";

export const LOW_TICKET_SCHEMA = "marketing-low-ticket-plan/v1" as const;
export const LOW_TICKET_RECEIPT_SCHEMA = "marketing-low-ticket-stage-receipt/v1" as const;

export const LOW_TICKET_STAGES = [
  "reference-intake", "transcript-timeline", "business-constraints", "market-research", "opportunity-score",
  "icp-jtbd", "offer-architecture", "unit-economics", "funnel-architecture", "asset-production",
  "compliance-qa", "tracking-validation", "launch-plan", "controlled-test", "observation", "diagnosis",
  "iteration", "winner-promotion", "scaling", "reporting-postmortem",
] as const;
export type LowTicketStage = typeof LOW_TICKET_STAGES[number];
export type EvidenceKind = "fact" | "inference" | "hypothesis";
export type GateStatus = "pass" | "blocked" | "pending";

export interface MarketEvidence {
  evidence_id: string;
  kind: EvidenceKind;
  claim: string;
  source_id: string | null;
  source_uri: string | null;
  observed_at: string | null;
  confidence: number | null;
}

export interface BusinessConstraints {
  objective: string;
  market: string;
  currency: string;
  total_budget_usd: number;
  max_daily_budget_usd: number;
  restrictions: string[];
}

export interface UnitEconomicsInput {
  price_usd?: number;
  cogs_usd?: number;
  payment_fee_rate?: number;
  refund_rate?: number;
  tax_rate?: number;
  support_cost_usd?: number;
}

export interface MetricObservation {
  metric: string;
  value: number | null;
  reason: string | null;
}

export interface LowTicketInput {
  campaign_id: string;
  objective: string;
  market: string;
  currency?: string;
  total_budget_usd: number;
  max_daily_budget_usd?: number;
  restrictions?: string[];
  reference_source_id?: string;
  transcript_segment_count?: number;
  transcript_complete?: boolean;
  evidence?: MarketEvidence[];
  economics?: UnitEconomicsInput;
  angles?: string[];
  hooks?: string[];
  now?: string;
}

export interface StagePlan {
  stage: LowTicketStage;
  status: "ready" | "planned" | "blocked";
  role_lane: string;
  depends_on: LowTicketStage[];
  evidence_ids: string[];
  blockers: string[];
  output_ids: string[];
}

export interface LowTicketReceipt {
  schema: typeof LOW_TICKET_RECEIPT_SCHEMA;
  receipt_id: string;
  plan_id: string;
  campaign_id: string;
  stage: LowTicketStage;
  status: StagePlan["status"];
  evidence_ids: string[];
  blockers: string[];
  created_at: string;
}

export interface LowTicketPlan {
  schema: typeof LOW_TICKET_SCHEMA;
  plan_id: string;
  campaign_id: string;
  dry_run: true;
  generated_at: string;
  constraints: BusinessConstraints;
  evidence_summary: { total: number; facts: number; inferences: number; hypotheses: number };
  opportunity: { heuristic_score: number | null; methodology: string; reason: string | null };
  economics: {
    price_usd: number | null;
    contribution_before_ads_usd: number | null;
    break_even_cpa_usd: number | null;
    break_even_roas: number | null;
    reason: string | null;
  };
  funnel: { identity: string; stages: string[]; publish_status: "not_requested" };
  asset_matrix: { angles: string[]; hooks: string[]; combinations: number; publish_status: "not_requested" };
  metrics: MetricObservation[];
  gates: { budget: GateStatus; evidence: GateStatus; compliance: GateStatus; tracking: GateStatus; publish: "blocked" };
  stages: StagePlan[];
}

interface PersistedPlan { plan: LowTicketPlan; receipts: LowTicketReceipt[] }

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => JSON.stringify(value);
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const now = (): string => new Date().toISOString();

const ROLE_LANES: Record<LowTicketStage, string> = {
  "reference-intake": "campaign-intake",
  "transcript-timeline": "campaign-intake",
  "business-constraints": "campaign-intake",
  "market-research": "product-icp-research",
  "opportunity-score": "product-icp-research",
  "icp-jtbd": "product-icp-research",
  "offer-architecture": "product-icp-research",
  "unit-economics": "metrics-experimentation",
  "funnel-architecture": "channel-content-planner",
  "asset-production": "copy-script",
  "compliance-qa": "compliance-safety",
  "tracking-validation": "technical-qa-runtime",
  "launch-plan": "publish-schedule",
  "controlled-test": "metrics-experimentation",
  observation: "metrics-experimentation",
  diagnosis: "metrics-experimentation",
  iteration: "copy-script",
  "winner-promotion": "promotion-ads",
  scaling: "promotion-ads",
  "reporting-postmortem": "completion-auditor",
};

function validateInput(input: LowTicketInput): string[] {
  const blockers: string[] = [];
  if (!input.campaign_id.trim()) blockers.push("campaign-id-required");
  if (!input.objective.trim()) blockers.push("objective-required");
  if (!input.market.trim()) blockers.push("market-required");
  if (!finiteNonNegative(input.total_budget_usd)) blockers.push("total-budget-invalid");
  const daily = input.max_daily_budget_usd ?? input.total_budget_usd;
  if (!finiteNonNegative(daily)) blockers.push("daily-budget-invalid");
  if (daily > input.total_budget_usd) blockers.push("daily-budget-exceeds-total");
  return blockers;
}

function economics(input: UnitEconomicsInput | undefined): LowTicketPlan["economics"] {
  const missing = ["price_usd", "cogs_usd", "payment_fee_rate", "refund_rate", "tax_rate", "support_cost_usd"]
    .filter((key) => !finiteNonNegative(input?.[key as keyof UnitEconomicsInput]));
  if (missing.length) return { price_usd: finiteNonNegative(input?.price_usd) ? input!.price_usd! : null, contribution_before_ads_usd: null, break_even_cpa_usd: null, break_even_roas: null, reason: `missing-economics-input:${missing.join(",")}` };
  const price = input!.price_usd!;
  const contribution = price * (1 - input!.payment_fee_rate! - input!.refund_rate! - input!.tax_rate!) - input!.cogs_usd! - input!.support_cost_usd!;
  return { price_usd: price, contribution_before_ads_usd: Number(contribution.toFixed(4)), break_even_cpa_usd: Number(Math.max(0, contribution).toFixed(4)), break_even_roas: contribution > 0 ? Number((price / contribution).toFixed(4)) : null, reason: contribution > 0 ? null : "non-positive-contribution-margin" };
}

function stagePlan(stage: LowTicketStage, index: number, input: LowTicketInput, globalBlockers: string[], evidenceIds: string[], ready: Set<LowTicketStage>): StagePlan {
  const depends = LOW_TICKET_STAGES.slice(0, index) as unknown as LowTicketStage[];
  const blockers = [...globalBlockers];
  if (stage === "reference-intake" && !input.reference_source_id) blockers.push("reference-source-not-provided");
  if (stage === "transcript-timeline" && (!input.transcript_complete || (input.transcript_segment_count ?? 0) < 1)) blockers.push("timestamped-transcript-not-ready");
  if (stage === "market-research" && evidenceIds.length === 0) blockers.push("supplied-market-evidence-required");
  if (stage === "opportunity-score" && evidenceIds.length === 0) blockers.push("opportunity-score-needs-evidence");
  if (stage === "compliance-qa" && input.restrictions?.some((item) => /medical|financial|guarantee/i.test(item))) blockers.push("restricted-claim-policy-review");
  if (stage === "tracking-validation") blockers.push("tracking-events-not-observed");
  if (stage === "controlled-test") blockers.push("launch-requires-explicit-approved-budget");
  if (stage === "observation" || stage === "diagnosis") blockers.push("metrics-not-observed");
  if (stage === "winner-promotion" || stage === "scaling") blockers.push("winner-and-risk-evidence-required");
  const priorBlocked = depends.some((item) => !ready.has(item));
  if (priorBlocked && !blockers.includes("dependency-not-ready")) blockers.push("dependency-not-ready");
  const status: StagePlan["status"] = blockers.length ? "blocked" : stage === "business-constraints" ? "ready" : "planned";
  if (status !== "blocked") ready.add(stage);
  return { stage, status, role_lane: ROLE_LANES[stage], depends_on: depends, evidence_ids: evidenceIds, blockers, output_ids: [`${stage}:${input.campaign_id}`] };
}

/** Build the complete Low Ticket workflow as a dry-run plan, without external actions. */
export function planLowTicket(input: LowTicketInput): LowTicketPlan {
  const globalBlockers = validateInput(input);
  const evidence = input.evidence ?? [];
  const evidenceSummary = {
    total: evidence.length,
    facts: evidence.filter((item) => item.kind === "fact").length,
    inferences: evidence.filter((item) => item.kind === "inference").length,
    hypotheses: evidence.filter((item) => item.kind === "hypothesis").length,
  };
  const opportunityScore = evidence.length ? Math.min(100, Math.round((evidenceSummary.facts * 25 + evidenceSummary.inferences * 10 + evidenceSummary.hypotheses * 5) / Math.max(1, evidence.length) + Math.min(50, evidence.length * 5))) : null;
  const constraints: BusinessConstraints = { objective: input.objective.trim(), market: input.market.trim(), currency: input.currency ?? "USD", total_budget_usd: input.total_budget_usd, max_daily_budget_usd: input.max_daily_budget_usd ?? input.total_budget_usd, restrictions: input.restrictions ?? [] };
  const planId = `lt-${sha256(stable({ campaign_id: input.campaign_id, constraints, evidence, economics: input.economics ?? null, angles: input.angles ?? [], hooks: input.hooks ?? [] })).slice(0, 24)}`;
  const ready = new Set<LowTicketStage>();
  const stages = LOW_TICKET_STAGES.map((stage, index) => stagePlan(stage, index, input, globalBlockers, evidence.map((item) => item.evidence_id), ready));
  const budgetStatus: GateStatus = globalBlockers.some((item) => item.includes("budget")) ? "blocked" : "pass";
  const evidenceStatus: GateStatus = evidence.length ? "pass" : "blocked";
  const restrictionStatus: GateStatus = input.restrictions?.some((item) => /medical|financial|guarantee/i.test(item)) ? "pending" : "pass";
  const angles = [...new Set((input.angles ?? []).map((item) => item.trim()).filter(Boolean))];
  const hooks = [...new Set((input.hooks ?? []).map((item) => item.trim()).filter(Boolean))];
  return {
    schema: LOW_TICKET_SCHEMA,
    plan_id: planId,
    campaign_id: input.campaign_id,
    dry_run: true,
    generated_at: input.now ?? now(),
    constraints,
    evidence_summary: evidenceSummary,
    opportunity: { heuristic_score: opportunityScore, methodology: "evidence-count heuristic; not a demand or profitability claim", reason: evidence.length ? null : "no-supplied-evidence" },
    economics: economics(input.economics),
    funnel: { identity: `funnel:${input.campaign_id}:v1`, stages: ["traffic", "pre-sell", "sales-page", "checkout", "thank-you-onboarding"], publish_status: "not_requested" },
    asset_matrix: { angles, hooks, combinations: angles.length * hooks.length, publish_status: "not_requested" },
    metrics: ["impressions", "clicks", "sessions", "checkout_started", "purchase", "refund", "contribution_margin"].map((metric) => ({ metric, value: null, reason: "not-observed" })),
    gates: { budget: budgetStatus, evidence: evidenceStatus, compliance: restrictionStatus, tracking: "blocked", publish: "blocked" },
    stages,
  };
}

function receiptFor(plan: LowTicketPlan, stage: StagePlan): LowTicketReceipt {
  return { schema: LOW_TICKET_RECEIPT_SCHEMA, receipt_id: `${plan.plan_id}:${stage.stage}`, plan_id: plan.plan_id, campaign_id: plan.campaign_id, stage: stage.stage, status: stage.status, evidence_ids: stage.evidence_ids, blockers: stage.blockers, created_at: plan.generated_at };
}

export function lowTicketPaths(root: string, planId = "current"): { dir: string; plan: string; receipts: string } {
  const dir = resolve(root, "data", "low-ticket");
  return { dir, plan: resolve(dir, `${planId}.hbi`), receipts: resolve(dir, "receipts.hbp") };
}

/** Persist one plan snapshot and idempotent stage receipts; no publish or spend effect exists here. */
export function persistLowTicketPlan(root: string, plan: LowTicketPlan): PersistedPlan {
  const paths = lowTicketPaths(root, plan.plan_id);
  mkdirSync(paths.dir, { recursive: true });
  const receipts = plan.stages.map((stage) => receiptFor(plan, stage));
  writeHbiAtomic(paths.plan, { plan, receipts });
  const prior = existsSync(paths.receipts) ? readHbp<LowTicketReceipt>(paths.receipts) : [];
  for (const receipt of receipts) if (!prior.some((item) => item.receipt_id === receipt.receipt_id)) appendHbp(paths.receipts, receipt);
  return { plan, receipts };
}
