## Summary

Use `rust_scorer` directory mode for generation scoring — one scorer process per
generation instead of one per creature. Closes #2422.

NEAT-AI-scorer (issue #17) now accepts either a single creature file or a
creatures directory plus a data directory. The orchestration side now detects
this contract: `Fitness.calculate` writes every unique creature in the
generation into a temporary directory keyed by UUID, invokes
`rust_scorer <creatures_dir> <data_dir>` exactly once, and reconciles the
top-level JSON map back to in-memory creatures via filename stem. The existing
per-creature path is preserved as a fallback when the scorer is disabled,
unavailable, opts out of batch mode (`NEAT_AI_RUST_SCORER_BATCH=false`), or
returns a payload that cannot be reconciled.

Changes:

- **`src/score/BatchRustScorerBridge.ts`** (new) — spawns `rust_scorer` in
  directory mode and maps entries back to their in-memory `Creature` by UUID
  stem. Reuses `reconcileBatchScorerOutput` for strict key-set validation so
  missing/extra keys surface as explicit `BatchScorerError`s.
- **`src/score/RustScorerBridgeInternal.ts`** (new) — shared probe cache,
  child-env merge, and injected command runner so the per-creature bridge and
  the new batch bridge agree on configuration and test hooks.
- **`src/score/RustScorerBridge.ts`** — exports `getEnvRustScorerConfig()` so
  `Fitness.calculate` can drive batch scoring from the same environment-derived
  config. Reads `NEAT_AI_RUST_SCORER_BATCH` (default `true`) into the resolved
  config.
- **`src/config/RustScorerConfig.ts`** — adds `batch?: boolean`. Batch is on by
  default when the scorer is enabled; operators can flip it off to keep the
  per-creature behaviour.
- **`src/architecture/Fitness.ts`** — when batch mode is enabled and a dataset
  directory is available, scores the whole unique-creature queue in one scorer
  call. Records `lastBatchScorerInvocations` alongside existing scorer
  telemetry. On any batch failure, logs the reconciliation reason and falls back
  to the per-creature worker path.
- **`src/NEAT/Neat.ts`** — propagates `setDataDir` to `Fitness` so batch scoring
  can invoke the scorer with the right data directory.

## Evidence

This is a backend/CLI change with no user interface. Verified via the new test
suites below:

- `test/score/BatchRustScorerBridge.ts` — 10 tests covering the batch bridge in
  isolation, including one-process-per-generation, stem mapping, missing/extra
  key failures, probe fallback, non-zero exit, and temp-directory cleanup.
- `test/NEAT/FitnessBatchRustScorer.ts` — 2 tests covering the Fitness wiring,
  including the "exactly one scorer process per generation" and "falls back to
  per-creature scoring on reconciliation failure" cases.

Quality gate (`./quality.sh --skip-discovery --skip-wasm --skip-tests`) passes
cleanly. Targeted test runs:

```
deno test test/score/ test/NEAT/FitnessBatchRustScorer.ts \
          test/NEAT/FitnessDeduplication.ts \
          test/NEAT/FitnessQueueDequeue.ts \
          test/NEAT/EvolveWasmPanicRecovery.ts
→ all passing
```

## Test Plan

- [x] `test/score/BatchRustScorerBridge.ts` — new file, 10 tests for the batch
      scorer bridge contract.
- [x] `test/NEAT/FitnessBatchRustScorer.ts` — new file, 2 tests verifying
      `Fitness.calculate` uses the batch scorer when enabled and falls back
      cleanly on reconciliation failure.
- [x] `test/score/RustScorerBridgeHardening.ts` — updated to include the new
      `batch: false` field on config literals (existing per-creature tests
      unchanged in intent).
- [x] `test/score/RustScorerIntegration.ts` — same field-only update.
- [x] Existing `test/score/BatchScorerReconciler.ts` reconciliation tests
      continue to pass unchanged.
- [x] Existing `test/NEAT/FitnessDeduplication.ts` and
      `test/NEAT/FitnessQueueDequeue.ts` Fitness loop tests continue to pass
      without modification.
