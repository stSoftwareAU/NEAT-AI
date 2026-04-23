## Summary
Split `src/NEAT/NeatEvolution.ts` into three focused modules so the evolution
loop is easier to read and its helpers can be tested in isolation. Closes #2395.

- `src/NEAT/CpuUtilisation.ts` — new module owning
  `captureUtilisationSnapshot` and `computeOverallCpuUtilisation` (Issue #2312
  utilisation helpers).
- `src/NEAT/ProcessCompletedResults.ts` — new module owning
  `processCompletedResults`, the training/discovery/replay drain that
  previously dominated the bottom of `NeatEvolution.ts`.
- `src/NEAT/NeatEvolution.ts` — now imports from the two new modules. `evolve`
  stays put as the top-level orchestrator, as required by the issue. Removed
  imports that only supported the extracted code (`blue`, `format`,
  `removeTag`, `CreatureUtil`, `validateAfterDiscoveryOrThrow`, `Approach`,
  `logReplaySummary`, `WorkerPool`).

No behavioural change — the extracted functions keep their signatures and
call sites.

### File sizes

| File | Before | After |
| --- | --- | --- |
| `src/NEAT/NeatEvolution.ts` | 1141 | 868 |
| `src/NEAT/CpuUtilisation.ts` | — | 75 |
| `src/NEAT/ProcessCompletedResults.ts` | — | 228 |

Note on the `~500` target: the issue acceptance criterion names `~500` lines
for `NeatEvolution.ts` but also requires `evolve` to remain the top-level
orchestrator in the same file. `evolve` itself is ~725 lines and was not in
scope to refactor further, so the 23% reduction here is the full gain
available from the two named extractions. Further reductions would require
splitting `evolve` itself, which is an explicit non-goal of this issue.

## Evidence
Backend refactor with no UI change. Verified via the quality gate:

- `./quality.sh --skip-discovery --skip-wasm` — **6041 passed, 0 failed, 3 ignored**.
- New unit test file `test/NEAT/CpuUtilisation.ts` — **7 passed, 0 failed**.
- Existing `test/NEAT/Evolve.ts` and `test/NEAT/EvolvePhaseTiming.ts` — pass
  unchanged, confirming no behavioural regression in the evolution loop.

## Test Plan
- Added `test/NEAT/CpuUtilisation.ts` with 7 tests exercising
  `computeOverallCpuUtilisation` (weighting, zero-duration phases, empty
  pools, non-positive total) and `captureUtilisationSnapshot` (pct
  calculation, zero-worker pools). These helpers previously had no direct
  coverage because they were file-private inside `NeatEvolution.ts`.
- All existing `test/NEAT/*` evolve tests continue to pass without
  modification.
