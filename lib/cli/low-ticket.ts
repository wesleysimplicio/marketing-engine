import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistLowTicketPlan, planLowTicket, type MarketEvidence } from "../low-ticket/workflow";

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function required(argv: string[], name: string): string {
  const value = flag(argv, name);
  if (!value?.trim()) throw new Error(`low-ticket: missing ${name}`);
  return value;
}

export async function cliEntry(argv: string[]): Promise<void> {
  if ((argv[0] ?? "plan") !== "plan") throw new Error("usage: low-ticket plan --campaign-id <id> --objective <text> --market <name> --budget <usd>");
  const root = resolve(process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd());
  const evidencePath = flag(argv, "--evidence-file");
  let evidence: MarketEvidence[] = [];
  if (evidencePath) {
    const resolved = resolve(root, evidencePath);
    if (!existsSync(resolved)) throw new Error(`low-ticket: evidence file not found: ${resolved}`);
    const parsed = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("low-ticket: evidence file must contain an array");
    evidence = parsed as MarketEvidence[];
  }
  const totalBudget = Number(required(argv, "--budget"));
  const dailyValue = flag(argv, "--daily-budget");
  const plan = planLowTicket({
    campaign_id: required(argv, "--campaign-id"),
    objective: required(argv, "--objective"),
    market: required(argv, "--market"),
    currency: flag(argv, "--currency"),
    total_budget_usd: totalBudget,
    max_daily_budget_usd: dailyValue === undefined ? undefined : Number(dailyValue),
    reference_source_id: flag(argv, "--reference-source-id"),
    transcript_segment_count: flag(argv, "--transcript-segments") ? Number(flag(argv, "--transcript-segments")) : undefined,
    transcript_complete: argv.includes("--transcript-complete"),
    restrictions: argv.flatMap((item, index) => item === "--restriction" && argv[index + 1] ? [argv[index + 1]!] : []),
    angles: flag(argv, "--angles")?.split(","),
    hooks: flag(argv, "--hooks")?.split(","),
    evidence,
  });
  persistLowTicketPlan(root, plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.gates.budget === "blocked") process.exitCode = 2;
}

if (import.meta.url.endsWith("/low-ticket.ts")) cliEntry(process.argv.slice(2)).catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });

