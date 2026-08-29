# Issue #92 — Loop Marketing conformance and upgrade evidence

The release-train manifest is pinned to the supported Loop core range
`3.38.1..3.99.99`. The compatibility fixture exposes the required receipt,
findings, completion, outbox, fencing, and extension-manifest capabilities,
and declares passing evidence for embedded, daemon, and remote transports.

The conformance code remains fail-closed for breaking changes, revoked or
unpinned releases, protocol drift, missing capabilities, and incomplete mode
evidence. Promotion retains the previous core pin for rollback.

Validation:

- `npm run test:node -- --test-name-pattern='conformance|release|reconciliation'`
- `npm run typecheck`
- `npm run ci:verify`

Live provider and publishing credentials are not used; external effects stay
dry-run or behind the core authority gates.
