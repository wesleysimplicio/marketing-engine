# Issue #88 — dedicated Loop Marketing roles

The extension now declares fourteen domain-specialized roles, each attached to
a Loop lifecycle stage and a bounded capability set:

`campaign-intake`, `product-icp-research`, `channel-content-planner`,
`copy-script`, `creative-image-video`, `brand-humanization`,
`compliance-safety`, `technical-qa-runtime`, `publish-schedule`,
`metrics-experimentation`, `promotion-ads`, `community-reply`,
`feedback-recovery`, and `completion-auditor`.

The completion auditor is independently separated from the production and
compliance roles. Manifest validation rejects duplicate role IDs, self-review,
and references to unknown peers. Scheduling, leases, retries, budgets and
terminal transitions remain Loop-core responsibilities.

Validation:

- `npm run test:unit -- --test-name-pattern='manifest|role validation'`
- `npm run typecheck`
