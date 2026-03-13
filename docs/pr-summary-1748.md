## Summary

Add unit tests for the 7 untested propagate modules, increasing direct test coverage from 42% to 100% of `src/propagate/` source files. Closes #1748.

## Modules Tested

| Module | Tests | Key Areas |
|--------|-------|-----------|
| `ActivationRange.ts` | 17 | Constructor validation, validate(), limit() with edge cases |
| `ErrorHelper.ts` | 9 | Clamping, NaN/Infinity handling, custom maxMagnitude |
| `SynapseState.ts` | 3 | Default values, mutability, instance independence |
| `BackPropagation.ts` | 26 | Config creation/validation, all 4 learning rate strategies, limitValue |
| `Bias.ts` | 17 | accumulateBias, limitBias, batch 4-way/8-way, non-finite guards |
| `Weight.ts` | 21 | accumulateWeight, limitWeight, batch 4-way/8-way, non-finite guards |
| `RecordElasticity.ts` | 19 | distributeRecordError, recordTargetFeasibilityFactor, getOrComputeRecordValue, buildRecordElasticLinks, constrainAndRedistributeRecordShares |

**Total: 112 new tests**

## Evidence

All 4818 tests pass (including 112 new) with `./quality.sh` clean.

## Test Plan

- `test/propagate/ActivationRange.ts` — constructor bounds, validate/limit with NaN/Infinity/boundary values
- `test/propagate/ErrorHelper.ts` — clamping with default and custom magnitudes, non-finite handling
- `test/propagate/SynapseState.ts` — default initialisation, mutability, instance independence
- `test/propagate/BackPropagation.ts` — config defaults/bounds, fixed/decay/adaptive/warm_restart strategies, limitValue
- `test/propagate/Bias.ts` — single and batch accumulation, learning rate limiting, non-finite guards
- `test/propagate/Weight.ts` — single and batch accumulation, positive/negative tracking, limiting
- `test/propagate/RecordElasticity.ts` — error distribution, feasibility factors, record value computation, elastic link building
