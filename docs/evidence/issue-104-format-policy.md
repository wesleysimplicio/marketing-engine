# Issue #104 — no-internal-JSON policy and migration gate

The internal-format scanner now supports explicit, reviewed directory
boundaries. A glob is rejected unless the registry declares
`scope = "directory"`; an exact path always takes precedence over a directory
boundary. This keeps the policy fail-closed while allowing bounded contract,
fixture, toolchain, and adapter trees to be inventoried without pretending
they are application state.

The repository registry has no errors or unclassified JSON/source findings in
baseline mode. Strict mode still returns a non-zero migration status for the
known legacy internal artifacts, which preserves the release-blocking behavior
until issue #103 completes their migration.

Validation:

- `npm run format:policy` — baseline clean
- `npm run format:policy:strict` — migration findings only
- `npm run test:node -- --test-name-pattern='format policy'`
- `npm run typecheck`

Exact internal paths remain the source of truth; directory scopes are explicit
reviewed boundaries, not a catch-all exception.
