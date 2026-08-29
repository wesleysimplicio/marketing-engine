# Issue #132 — provider-neutral transcription router

The reference layer now exposes a provider-neutral `TranscriptionRouter` with
an injected `TranscriptionProvider` contract. Selection is deterministic and
considers language, maximum duration, privacy class, cost class, explicit
provider overrides, and circuit state.

Long text is split into contiguous timeline windows. Recombination rejects
overlapping or reversed windows. Language detection is deliberately
conservative: ambiguous text returns `manual_review` unless the caller gives a
language override.

Completed and partial results are persisted in an HBI cache keyed by source,
text, language, provider, and provider version. HBP receipts record cost,
latency, provider version, confidence, cached segments, resumed segments, and
the final status. A later run requests only missing segment IDs.

The CLI supports:

```text
marketing-engine reference transcribe --source supplied-transcript \
  --text "texto autorizado" --language pt-BR
```

No network provider is bundled into this change. The supplied-transcript
provider is local and deterministic; external adapters can be injected later
behind the same contract and remain subject to the normal `DRY_RUN` and
privacy gates.

Validation:

- `npm run test:unit -- --test-name-pattern='transcription|reference intake'`
- `npm run typecheck`
- `node bin/marketing-engine.mjs reference transcribe --source supplied-transcript --text 'Você pode usar isso' --language pt-BR`
