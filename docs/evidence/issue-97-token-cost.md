# Issue #97 — token cost provenance

Provider usage is authoritative when a provider returns `tokens_in` and
`tokens_out`. When usage is absent, `js-tiktoken` estimates BPE tokens and the
result records `source`, `encoding`, and a precise fallback reason. If the
tokenizer itself fails, the measurement is marked `unavailable` instead of
inventing a cost.

The cost ledger keeps stage and correlation metadata, so campaign/run totals
can reconcile provider usage, tokenizer estimates, unavailable measurements,
and cache reuse without persisting prompts or generated content.

Validation:

- `npm run test:node -- --test-name-pattern='cost|provider usage|BPE fallback'`
- `npm run typecheck`

The test covers provider-authoritative usage, PT-BR/emoji BPE fallback,
unknown-model provenance, and tokenizer failure.
