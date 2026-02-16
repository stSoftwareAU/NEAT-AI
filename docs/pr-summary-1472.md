# PR Summary: Refactor: Extract DiscoverStructure.ts into focused modules (#1472)

Closes #1472

## Summary

Decomposes `DiscoverStructure.ts` (3,857 lines) into 7 focused, single-responsibility modules following the extraction pattern established by the Creature.ts refactoring (Issue #1409). The original file is reduced to a 1,823-line facade/coordinator that delegates to extracted standalone functions.

## Extracted Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `DiscoverLogging.ts` | 544 | Logging, diagnostic formatting, Rust diagnostic descriptions |
| `FocusSelection.ts` | 734 | Focus neuron selection, roulette-wheel sampling, Rust focus ranking |
| `DiscoverSquashAnalysis.ts` | 455 | Squash function analysis, harmful neuron detection |
| `DiscoverAnalysis.ts` | 341 | Candidate mapping, filtering, deduplication, Rust analysis collection |
| `NeuronImpact.ts` | 253 | Neuron impact estimation, squash derivatives, impact-sorted listing |
| `DiscoverDataLoading.ts` | 213 | File I/O, binary record loading, Parquet record loading |
| `RustAnalysisCache.ts` | 196 | Rust combined analysis caching, cache key generation, parallel result conversion |

## Design Decisions

- **Standalone functions with explicit parameters** rather than shared context objects, matching the existing `DiscoveryApplication.ts` and `RustFlushDiagnostics.ts` patterns
- **Private delegate methods** on the class preserve backward-compatible instance access for existing tests (e.g. `mapRustCandidate`, `findCandidateSquash`)
- **Recording phase methods** (record, flush, writeRustParquetChunk) remain in the facade due to deep private field mutations across many instance variables
- **Re-exports** from `DiscoverStructure.ts` maintain backward compatibility for all external consumers
- **No functional changes** - purely structural refactoring

## Evidence

- `DiscoverStructure.ts`: 3,857 → 1,823 lines (53% reduction)
- All 3,823 tests pass (0 failures)
- `quality.sh` passes cleanly (fmt, lint, type-check, all tests)
- No external import paths changed

## Test Plan

- [x] `quality.sh` passes (fmt + lint + type-check + all 3,823 tests)
- [x] No changes to test files required (except that 4 tests accessing private instance methods now delegate correctly)
- [x] All re-exports from `DiscoverStructure.ts` preserved for backward compatibility
- [x] No functional behaviour changes
