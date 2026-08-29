# Issue #96 — Prototype-First gate

The prototype gate runs before publish or spend:

`brief/ICP → prototype budget → storyboard/copy/mock variants → preview/specs →
brand/humanization/compliance → dry-run publish/ads simulation → ACCEPT/REVISE/REJECT`.

It defaults to `DRY_RUN`, rejects attempts to tamper with that boundary, keeps
prototype credentials-free, requires diverse variants and objective judges,
invalidates stale approvals on relevant drift, and records a learning when a
prototype is rejected. Real publishing remains behind explicit human/core
authorization and governed effects.

Metrics that cannot be observed in dry-run remain `null` with a reason; no
conversion or performance outcome is fabricated.

Validation:

- `npm run test:node -- --test-name-pattern='prototype|dry-run|drift|metrics'`
- `npm run typecheck`
- `npm run ci:verify`
