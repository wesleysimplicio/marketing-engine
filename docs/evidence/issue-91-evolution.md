# Issue #91 — marketing evolution and replication policy

The marketing specialization emits deterministic improvement/evolution
proposals from findings and keeps defects/regressions as findings. Proposals
are tested through replay, shadow, and canary phases; protected compliance and
safety gates cannot be weakened. Replication admission is bounded by critical
path, confidence, backlog, agent slots, and declared budgets.

Hedged candidates must be independently verified, carry the active fence, and
produce no external effect before the first verified candidate is selected.
Losers are returned for core cancellation/fence revocation, while
irreversible publishing and ads are never replicated automatically.

Validation:

- `npm run test:unit -- --test-name-pattern='evolution|replication|candidate|canary'`
- `npm run typecheck`
