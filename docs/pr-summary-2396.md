## Summary
Split `src/config/NeatConfigParsers.ts` (897 lines, 22 parsers) into seven
focused sub-modules under `src/config/parsers/`, grouped by concern.
`NeatConfigParsers.ts` is now a 45-line barrel that re-exports the parsers,
preserving every existing import path. No behavioural change. Closes #2396.

## Acceptance Criteria
- [x] No file under `src/config/parsers/` exceeds 250 lines (max is
      `MutationParsers.ts` at 205 lines).
- [x] `NeatConfigParsers.ts` is a 45-line barrel (under 50 lines).
- [x] Each new parser file has at least one happy-path and one
      invalid-input test under `test/config/parsers/`.
- [x] No behavioural change: 6118 existing tests still pass.
- [x] `./quality.sh` passes.

## Module Layout
| File | Parsers | Lines |
|------|---------|------:|
| `parsers/RuntimeParsers.ts` | parseWorkerThreadCap, parseWasmCache, parseMemoryConfig, parseParallelEvaluation | 145 |
| `parsers/DiscoveryParsers.ts` | parseDiscoveryMinCandidates, parseDiscoveryCache, parseDiskSpaceConfig | 110 |
| `parsers/MutationParsers.ts` | parseAdaptiveMutationThresholds, parsePlateauDetection, parseStabilityAdaptation, parseMcmc | 205 |
| `parsers/PopulationParsers.ts` | parseFineTunePopulation, parseAdaptivePopulation, parseEnsembleDiversity | 167 |
| `parsers/TrainingParsers.ts` | parseHyperparameterEvolution, parseQuantumStep, parsePredictiveCoding, parseCrossValidation | 159 |
| `parsers/RegularisationParsers.ts` | parseWeightRegularisation, parseBiasRegularisation | 95 |
| `parsers/DataParsers.ts` | parseDataFuzzing, parseDataQuantisation | 75 |
| `NeatConfigParsers.ts` (barrel) | — re-exports all 22 — | 45 |

## Evidence
Backend refactor with no UI surface, so no screenshot. Verified by:
- 69 new unit tests under `test/config/parsers/` (happy-path, override
  application, and invalid-input rejection for every parser).
- Full quality gate passes: `./quality.sh --skip-discovery --skip-wasm` →
  6118 passed, 0 failed, 3 ignored.
- Existing tests that import from `@config/NeatConfigParsers.ts`
  (`test/config/DiscoveryCacheConfig.ts`, `test/config/DiskSpaceConfig.ts`,
  `test/propagate/DataQuantisation.ts`, `test/propagate/DataFuzzing.ts`)
  continue to pass through the barrel.

## Test Plan
- [x] `deno test --allow-all test/config/parsers/` — all 69 new tests pass.
- [x] `./quality.sh --skip-discovery --skip-wasm` — full suite green.
- [x] No file under `src/config/parsers/` exceeds 250 lines.
- [x] `NeatConfigParsers.ts` barrel under 50 lines.
