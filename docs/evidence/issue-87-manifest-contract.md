# Issue #87 — versioned manifest, capability probe, and reconciliation

The official `extensions/loop.marketing/manifest.json` now declares the
versioned `simplicio.loop-extension/v1` contract, a bounded Loop core range,
source adapters, context schemas, stage overlays, fourteen role bindings,
resource classes, fail-closed gates, and receipt schemas. Its lock file records
the canonical manifest hash, adapter version, upstream pin, required/optional
capabilities, and forbidden core-owned authorities.

`lib/extension/contract.ts` performs the capability probe, range negotiation,
hash verification, and actionable `READY`/`DEGRADED`/`BLOCKED` classification.
`lib/extension/reconcile.ts` converts core receipts into a projection with the
core receipt remaining authoritative and replay deduplication by receipt ID.

Validation:

- `npm run test:unit -- --test-name-pattern='capability probe|version negotiation|manifest hash'`
- `npm run typecheck`
- `npm run ci:verify`
