# Issue #131 — canonical reference intake

`ingestReference` normalizes supplied transcripts, YouTube URLs, HTTPS URLs,
and local files into `marketing-reference-source/v1`. It validates protocol,
host allowlists, local-root boundaries, size limits, permissions, and
idempotency. URL intake never fetches the network: dry-run records a deferred
receipt with the reason rather than pretending content was collected.

The manifest is an atomic HBI snapshot and receipts are a checksummed HBP
stream. Replaying an identical source reuses the existing source and receipt.
Rejected inputs are persisted with an explicit denial reason; no secrets or
arbitrary query parameters are retained in canonical URL identities.

Validation:

- `npm run test:unit -- --test-name-pattern='reference|URL|local files'`
- `npm run typecheck`
