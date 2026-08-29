# Issue #100 — media properties, compliance fixtures, mutation setup

Image and video adapter constraints are covered by `fast-check`; caption
fan-out remains deterministic across the supported platforms. The compliance
suite includes realistic multilingual content, including PT-BR examples, and
the repository already pins Stryker with a focused `stryker.config.json` for
the routing/provider matrix.

Validation:

- `npm run test:node -- --test-name-pattern='property|golden|creative'`
- `npm run typecheck`
- `npm run ci:verify`

Mutation score is intentionally not reported here because it was not run in
this environment; the configured command remains `npm run mutation`.
