# Issue #90 — receipts, findings, reporting, and completion projections

Marketing reporting remains a projection over canonical Loop receipts. Receipt
projection now deduplicates by `receipt_id`, so replaying a transport or
restarting a watcher cannot append a second timeline row. Findings use stable
fingerprints, a durable outbox, sanitized tracker payloads, and remote
re-query before completion is accepted.

The completion auditor consumes core terminal intent and can return
`REGRESSED`/`BLOCKED` when receipts are stale, findings are unresolved, or
remote confirmation is missing. It never creates a competing ledger or
completion engine.

Validation:

- `npm run test:unit -- --test-name-pattern='receipt|reporting|completion|finding'`
- `npm run typecheck`
