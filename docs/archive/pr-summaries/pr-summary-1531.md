## Summary

Improves test code coverage by adding ~200 new unit tests across 7 test files,
targeting previously untested source files identified via Codecov analysis.
Closes #1531.

### New test files

| Test file                                      | Source coverage                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `test/methods/activations/SquashDerivative.ts` | Individual squash() and derivative() correctness for all 32 standard activation functions      |
| `test/methods/activations/CalculateError.ts`   | calculateError() for 32 activations: zero-error, finite results, directional correctness       |
| `test/methods/activations/Activations.ts`      | Activations registry: find, aliases (RELU, CLIPPED, INVERSE, SINUSOID), list, pickRandomSquash |
| `test/methods/activations/SquashUtils.ts`      | isAggregationSquash() for all aggregation types and non-aggregation types                      |
| `test/methods/Selection.ts`                    | Selection strategies: FITNESS_PROPORTIONATE, POWER, TOURNAMENT                                 |
| `test/errors/ValidationError.ts`               | ValidationError construction and all 7 reason types                                            |
| `test/utils/TagUtils.ts`                       | dedupeTagsByNameValue and mergeTagsByNameValue                                                 |

### Coverage areas addressed

- **Activation function types** (`src/methods/activations/types/`): All 32
  activation functions now have direct squash/derivative tests covering
  mathematical correctness
- **calculateError()**: Previously untested error calculation path for all
  activations
- **SquashUtils** (`src/methods/activations/SquashUtils.ts`): Previously 0%
  coverage
- **Selection** (`src/methods/Selection.ts`): Previously 0% coverage
- **ValidationError** (`src/errors/ValidationError.ts`): Previously 0% coverage
- **TagUtils** (`src/utils/TagUtils.ts`): Previously 0% coverage

## Evidence

This is a backend/test-only change with no visual output. Evidence is the test
results:

- All 4140 tests pass (including ~200 new tests)
- `quality.sh` passes cleanly (fmt, lint, type-check, tests)

## Test Plan

- Added `test/methods/activations/SquashDerivative.ts` - 55 tests for
  squash/derivative
- Added `test/methods/activations/CalculateError.ts` - 101 tests for
  calculateError
- Added `test/methods/activations/Activations.ts` - 12 tests for registry
  operations
- Added `test/methods/activations/SquashUtils.ts` - 12 tests for aggregation
  classification
- Added `test/methods/Selection.ts` - 4 tests for selection strategies
- Added `test/errors/ValidationError.ts` - 11 tests for error construction
- Added `test/utils/TagUtils.ts` - 11 tests for tag deduplication/merging
