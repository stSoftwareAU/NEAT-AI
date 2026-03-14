## Summary

Audit propagation module tests: consolidate duplicate test files, rewrite
implementation-detail tests as behavioural tests, fix assertion-less tests, and
improve test names for clarity. Addresses #1766.

### Changes

1. **ErrorHelper.ts**: Consolidated from ErrorHelper.ts,
   ErrorHelperBehaviour.ts, and ErrorHelperTest.ts into 16 tests covering
   non-finite handling, pass-through, clamping, boundary values, and sign
   preservation.
2. **ActivationRange.ts**: Consolidated from ActivationRange.ts and
   ActivationRangeBehaviour.ts into 22 tests covering constructor, validate,
   limit, and squash-specific ranges.
3. **RecordElasticity.ts**: Consolidated from RecordElasticity.ts,
   RecordElasticityBehaviour.ts, and RecordElasticityTest.ts into ~40 tests
   covering distributeRecordError, feasibility factors, elastic links, and share
   redistribution.
4. **ElasticDistribution.ts**: Consolidated from ElasticDistribution.ts (3
   tests) and ElasticDistributionBehaviour.ts (22 tests), keeping the
   comprehensive version.
5. **BackPropagation.ts**: Consolidated from BackPropagation.ts,
   BackPropagationConfig.ts, BackPropagationConfigBehaviour.ts, and absorbed
   LimitValue.ts into ~45 tests covering config, strategies, and limitValue.
6. **Bias.ts**: Consolidated from Bias.ts and BiasCalculation.ts into ~25 tests
   covering direction/magnitude, non-finite handling, and batch accumulation.
7. **Trace.ts**: Fixed test with no assertions; now verifies applyLearnings
   modifies creature and remains valid. Removed unused helper functions.
8. **LimitBias.ts, LimitWeight.ts, ToValue.ts, Generation.ts**: Renamed vague
   test names to descriptive behavioural names.

### Files Deleted (11)

- test/propagate/ActivationRangeBehaviour.ts
- test/propagate/BackPropagationConfig.ts
- test/propagate/BackPropagationConfigBehaviour.ts
- test/propagate/BiasCalculation.ts
- test/propagate/ElasticDistributionBehaviour.ts
- test/propagate/ErrorHelperBehaviour.ts
- test/propagate/ErrorHelperTest.ts
- test/propagate/LimitValue.ts
- test/propagate/RecordElasticityBehaviour.ts
- test/propagate/RecordElasticityTest.ts

## Test Plan

- All tests pass via `./quality.sh`
- No production code changes — test-only audit
