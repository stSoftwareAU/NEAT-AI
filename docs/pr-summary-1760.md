## Summary

Consolidated the duplicated 4-way and 8-way batch accumulation functions in the propagate module into generic parameterised functions. Addresses #1760.

- Created `accumulateBiasBatchNWay()` in `src/propagate/Bias.ts` — a generic bias batch accumulation function parameterised by batch size
- Created `accumulateWeightBatchNWay()` in `src/propagate/Weight.ts` — a generic weight batch accumulation function parameterised by batch size
- Refactored `accumulateBiasBatch4Way()` and `accumulateBiasBatch8Way()` to delegate to the generic function
- Refactored `accumulateWeightBatch4Way()` and `accumulateWeightBatch8Way()` to delegate to the generic function
- All existing 4-way/8-way wrapper functions are preserved for backward compatibility — no callers need updating

## Evidence

All 4896 existing tests pass, plus 12 new tests for the generic functions. The wrapper functions delegate directly with zero logic duplication.

## Test Plan

- Added `test/propagate/AccumulateBiasBatchNWay.ts` (6 tests):
  - Verifies NWay with batchSize=4 matches 4-way wrapper
  - Verifies NWay with batchSize=8 matches 8-way wrapper
  - Verifies NWay with batchSize=1 matches single accumulateBias call
  - Verifies NWay with batchSize=6 (non-standard) matches individual calls
  - Verifies non-finite values are skipped correctly
  - Verifies multiple iterations with batchSize=3 accumulate correctly

- Added `test/propagate/AccumulateWeightBatchNWay.ts` (6 tests):
  - Verifies NWay with batchSize=4 matches 4-way wrapper
  - Verifies NWay with batchSize=8 matches 8-way wrapper
  - Verifies NWay with batchSize=1 matches single accumulateWeight call
  - Verifies NWay with batchSize=6 (non-standard) matches individual calls
  - Verifies non-finite values are skipped correctly
  - Verifies multiple iterations with batchSize=3 accumulate correctly
