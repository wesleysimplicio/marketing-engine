# Issue #93 — Loop core/Hub integration boundary

The integration surface is the official `simplicio.loop-extension/v1`
manifest. Marketing declares source adapters, context schemas, stage overlays,
specialized roles, resource classes, and governed effects; the Loop core owns
the stage graph, queue, leases/fences, budgets, receipts, findings, transports,
and terminal state.

The release-train descriptor now uses the same supported core range as the
extension (`3.38.1..3.99.99`) and the compatibility fixture explicitly
declares the receipt/findings/completion/outbox capabilities it exercises.
Embedded, daemon, and remote requests are compared through the canonical
transport receipt shape. Yool and journal data remain projections only.

Validation:

- `npm run test:node -- --test-name-pattern='transport|release|manifest|reconciliation'`
- `npm run typecheck`
- `npm run ci:verify`
