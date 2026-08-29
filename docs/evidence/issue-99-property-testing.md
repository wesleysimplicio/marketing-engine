# Issue #99 — property tests and real-content fixtures

The routing and caption pipeline has deterministic property coverage with
`fast-check`. Properties cover provider resolution, fallback selection,
platform bounds, complete fan-out, stable ordering, and preservation of the
maximum valid caption prefix.

The fixture `tests/fixtures/real-content-asolaria.json` exercises realistic
multilingual copy rather than placeholder-only strings. The pull-request
template carries the invariant checklist for reviewers.

Validation:

- `npm run test:node -- --test-name-pattern='property|golden|realistic'`
- `npm run typecheck`

The properties use bounded inputs and assert invariants, not fabricated
business outcomes.
