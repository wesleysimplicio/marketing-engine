# Issue #130 — Low Ticket golden path

The repository now exposes `planLowTicket`, a deterministic dry-run planner
for the full reference-to-postmortem lifecycle:

`reference intake → transcript/timeline → business constraints → market research → opportunity score → ICP/JTBD → offer architecture → unit economics → funnel architecture → asset production → compliance/QA → tracking validation → launch plan → controlled test → observation → diagnosis → iteration → winner promotion → scaling → reporting/postmortem`

The plan is a Loop overlay and delegates role lanes to the existing marketing
bindings. It does not introduce an autonomous scheduler, queue, budget ledger,
or publish lifecycle. `persistLowTicketPlan` writes a typed HBI plan and
idempotent HBP stage receipts under `data/low-ticket/`.

Safety and evidence behavior:

- `dry_run` is always true for this planner and publish is always blocked;
- budgets are validated against total and daily caps;
- opportunity scoring is explicitly a supplied-evidence-count heuristic, not a
  demand, causal, or profitability claim;
- economics remain `null` with a reason until all configured inputs are present;
- unobserved funnel metrics remain `null` with `not-observed`;
- missing references, timestamped transcripts, evidence, tracking, winners, or
  risk evidence block the dependent stages;
- no market, revenue, conversion, or financial outcome is fabricated.

CLI example:

```text
marketing-engine low-ticket plan \
  --campaign-id camp-001 \
  --objective "validar uma oferta" \
  --market "software B2B" \
  --budget 100
```

Validation:

- `npm run test:unit -- --test-name-pattern='low-ticket'`
- `npm run typecheck`
- `node bin/marketing-engine.mjs low-ticket plan --campaign-id camp-001 --objective 'validar uma oferta' --market 'software B2B' --budget 100`
