## Summary

Adds strict reconciliation for batch scorer output so NEAT-AI never silently
mis-scores a generation. Introduces `src/score/BatchScorerReconciler.ts` and the
typed `BatchScorerError` so callers can parse a single-JSON batch scorer
payload, verify the result key set exactly matches the expected creature
filename stems, and validate every result carries finite numeric `score`,
`error`, and non-negative integer `recordCount` fields. Any key mismatch or
malformed result fails fast with an actionable diagnostic that names the
offending stems and fields. Closes #2423.

The module is deliberately scoped to parser/reconciliation hardening per the
issue's note — no process orchestration is changed.

### Error semantics

`BatchScorerError.reason` distinguishes:

- `INVALID_JSON` — raw payload string could not be parsed.
- `NOT_AN_OBJECT` — parsed value is not a JSON object (e.g. array, null).
- `MISSING_KEYS` — one or more expected creature stems were absent.
- `EXTRA_KEYS` — scorer returned stems not in the expected set.
- `MALFORMED_RESULT` — one or more results failed numeric-field validation.

`missingKeys`, `extraKeys`, and `malformedKeys` are populated on the error so
callers can emit structured telemetry in addition to the human-readable message.

## Evidence

Backend/CLI change with no UI surface. Verified via the new integration test
suite:

```
running 20 tests from ./test/score/BatchScorerReconciler.ts
BatchScorerReconciler - happy path parses and returns a map ... ok
BatchScorerReconciler - accepts pre-parsed object payload ... ok
BatchScorerReconciler - fails fast on invalid JSON string ... ok
BatchScorerReconciler - rejects non-object payloads ... ok
BatchScorerReconciler - rejects null payload ... ok
BatchScorerReconciler - fails fast when a key is missing ... ok
BatchScorerReconciler - fails fast when an extra key is present ... ok
BatchScorerReconciler - reports both missing and extra keys together ... ok
BatchScorerReconciler - rejects result that is not an object ... ok
BatchScorerReconciler - rejects missing numeric field ... ok
BatchScorerReconciler - rejects NaN for a numeric field ... ok
BatchScorerReconciler - rejects infinite error field ... ok
BatchScorerReconciler - rejects negative recordCount ... ok
BatchScorerReconciler - rejects non-integer recordCount ... ok
BatchScorerReconciler - empty expected set with empty payload is accepted ... ok
BatchScorerReconciler - duplicate expected stems are deduplicated ... ok
BatchScorerReconciler - reports all malformed creatures in one pass ... ok
BatchScorerReconciler - preserves extra optional numeric fields ... ok
BatchScorerReconciler - rejects array-typed result ... ok
BatchScorerError exposes reason for programmatic handling ... ok

ok | 20 passed | 0 failed
```

Full quality gate: `./quality.sh --skip-discovery --skip-wasm` →
`6185 passed | 0 failed | 3 ignored` (5m39s).

## Test Plan

- `test/score/BatchScorerReconciler.ts` (new) — 20 tests covering every
  acceptance criterion:
  - **Happy path** — string and pre-parsed object payloads both return a map.
  - **Mismatch path** — missing keys, extra keys, combined mismatch (both
    surfaced in the same message), and deduplication of expected stems.
  - **Malformed path** — non-object result, missing numeric field, NaN,
    infinite, negative, and non-integer `recordCount`, array-typed result, and a
    multi-creature malformed case that reports every offender in one pass.
  - **Error type** — `BatchScorerError.reason` is exposed for programmatic
    handling and `instanceof Error` holds.
