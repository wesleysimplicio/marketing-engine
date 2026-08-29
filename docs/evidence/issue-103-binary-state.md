# Issue #103 — internal state on HBP/HBI/TOML

Append-only marketing savings state now uses a checksummed HBP stream at
`.simplicio/ledger/marketing-savings-events.hbp`. The previous marketing JSONL
path is accepted only by the bounded one-shot migrator, copied to `.bak`, and
never used as a runtime reader after migration. Existing run journals and
manifests already use HBP/HBI, while human configuration remains TOML.

The upstream `.simplicio/ledger/savings-events.jsonl` file is explicitly
classified as simplicio-cli-owned compatibility state; marketing does not
append to or rewrite it. Generated `outputs/` are skipped from the internal
state scan, and the strict policy is clean after the owned migration.

Validation:

- `npm run test:unit -- --test-name-pattern='marketing savings ledger|legacy marketing'`
- `npm run format:policy`
- `npm run format:policy:strict`
- `npm run typecheck`
