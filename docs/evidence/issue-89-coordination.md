# Issue #89 — claims, fan-out and effects delegated to Loop core

`lib/extension/coordination.ts` defines the marketing-to-core delegation
envelope for campaign, piece, creative, and target claim units. It carries
the core lease/fence identity, deterministic stage dependencies, candidate-only
fan-out, and effect intents with idempotency keys.

The extension makes no scheduling or execution decision. Publish, ads, and
comment effects require core authorization and confirmation, default to
`dry_run`, and are returned as reconciliation intents. STOP cleanup is a
declarative list of candidate stages to cancel, fences to revoke, and effect
keys to reconcile.

Validation:

- `npm run test:unit -- --test-name-pattern='delegation|claim decisions|invalid dependencies'`
- `npm run typecheck`
