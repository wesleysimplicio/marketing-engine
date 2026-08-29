# Issue #102 — blocking CI quality gate

The repository now exposes the exact command referenced by the protected
workflow:

```text
npm run ci:verify
```

`ci:verify` runs `scripts/verify-quality-gate.mjs`, which fails closed when the
workflow, package scripts, coverage thresholds, or required checks drift. The
workflow remains read-only with respect to repository contents and runs on
pull requests and pushes to `main`.

Validation performed for this change:

- `npm run test:node`
- `npm run typecheck`
- `npm run ci:verify`

No performance or coverage number is asserted here beyond the thresholds
declared in the repository configuration; the gate is the source of truth.
