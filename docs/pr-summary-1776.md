## Summary

Cross-suite test organisation review: restructure the test/ directory for
consistency, eliminate cross-area duplicates, and enforce naming conventions.
Closes #1776.

### Changes Made

**Directory case fixes** (5 directories):
- `test/Compact` -> `test/compact` (matches `src/compact`)
- `test/Upgrade` -> `test/upgrade` (matches `src/upgrade`)
- `test/Tag` -> `test/tag` (standardised)
- `test/Constants` -> `test/constants` (standardised)
- `test/FeedForward` -> `test/feedForward` (camelCase convention)

**Directory consolidation** (4 directories removed):
- `test/customCost/` merged into `test/costs/` (related cost function tests)
- `test/Offspring/` merged into `test/breed/` (breeding tests consolidated)
- `test/squash/` merged into `test/methods/activations/` (activation function tests)
- `test/presets/` merged into `test/config/` (configuration tests)
- `test/disconnect/` merged into `test/creature/` (creature method tests)
- `test/trace/` merged into `test/creature/` (creature tracing tests)

**Cross-area duplicate resolved**:
- Removed `test/Offspring/GeneticCompatibility.ts` (4 tests) as a duplicate
  of the more comprehensive `test/breed/GeneticCompatibilityBehavioural.ts`
  (8 tests covering all the same scenarios plus additional edge cases)

**Root-level file relocation** (72 files moved):
- Activation tests -> `test/methods/activations/` (13 files)
- WASM tests -> `test/wasm/` (9 files)
- Creature lifecycle tests -> `test/creature/` (11 files)
- Propagation/trace tests -> `test/propagate/` (6 files)
- Evolution/deduplication tests -> `test/NEAT/` (15 files)
- Cost function tests -> `test/costs/` (3 files)
- Architecture tests -> `test/architecture/` (7 files + PublicAPI.ts)
- Neuron tests -> `test/neuron/` (1 file)
- Config tests -> `test/config/` (1 file)
- Utility tests -> `test/utils/` (3 files)
- Worker tests -> `test/workers/` (1 file)
- Script tests -> `test/scripts/` (1 file)

**Naming consistency fixes**:
- `trainDir_custom_cost.ts` -> `TrainDirCustomCost.ts` (PascalCase)
- `DiscoverDirectoryPerformanceSummary_test.ts` -> `DiscoverDirectoryPerformanceSummary.ts`
  (remove non-standard `_test` suffix)

### Directories retained as-is (with rationale)

- `test/optimize/` vs `test/optimization/`: Different purposes (code
  optimisation vs training optimisation) - no consolidation needed
- `test/ErrorGuidedStructuralEvolution/`: 27 files, well-organised; mirrors
  `src/architecture/ErrorGuidedStructuralEvolution/`
- `test/CRISPR/`, `test/score/`, `test/fix/`, `test/docs/`: Purpose-specific
  directories with clear scope

### Coverage gap analysis

No significant coverage gaps identified. The test suite (4,483 tests across
642 files) covers all major src/ directories. Minor gaps in `src/deprecated/`
are expected (deprecated activation functions).

## Evidence

- All 4,483 tests pass after reorganisation
- `./quality.sh` passes cleanly (fmt, lint, type-check, tests)
- Only 1 test file removed (duplicate), zero tests lost

## Test Plan

- No new tests added (this is an organisational refactoring)
- Verified all 4,483 existing tests pass after file moves
- Import paths verified correct for all moved files
