# Issue #94 — pipeline as Loop stage overlays

The extension maps marketing work onto Loop lifecycle hooks: intake/brief,
planning/strategy, independent copy and creative execution, deterministic
formatting and compliance, watching, governed delivery, reporting, and
completion evidence. Resource classes and idempotency identities are declared
per stage, with core-owned scheduling and budgets.

Deterministic stages run without model tokens, unavailable measurements remain
`null` with a reason, and publish/ads/comments require intent, authorization,
fence, confirmation, and receipt. The existing overlay benchmark is a local
microbenchmark only; it does not assert production provider latency.

Validation:

- `npm run test:node -- --test-name-pattern='overlay|extension manifest|fenced effect'`
- `npm run typecheck`
- `npm run ci:verify`
