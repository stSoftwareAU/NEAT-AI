## Summary

Improved code coverage with real "what" tests across multiple previously
untested modules (#1356).

Added **18 new test files** with **~120 test cases** covering:

- **Cost functions** (0% → covered): MSE, MAE, MAPE, MSLE, CrossEntropy, HINGE,
  and the Costs registry
- **Mutation operators** (gaps filled): AddBackCon, AddSelfCon, ModBias,
  SubConnection, SubNeuron
- **Configuration modules** (0% → covered): AdaptiveMutationThresholds,
  EnsembleDiversityConfig, StabilityAdaptationConfig, WeightRegularisationConfig
- **Upgrade module** (gaps filled): UpgradeOne, UpgradeTwo, and version routing
  (getMajorVersion, upgrade, upgradeSemanticVersionIfForwardOnlyConfirmed)

All tests are real "what" tests that:

- Call actual functions with test data
- Assert on return values, side effects, and error conditions
- Verify creatures remain valid after mutations (via `creatureValidate()`)
- Test edge cases (empty inputs, boundary values, error paths)
- Include stress tests for mutation operators

## Evidence

This is a backend/test-only change with no UI components. Evidence is the test
results:

- All 2156 tests pass (including ~120 new tests)
- `./quality.sh` passes cleanly (format, lint, type-check, all tests)
- No existing tests were modified or removed

## Test Plan

### New test files added:

**Cost functions** (`test/costs/`):

- `MSE.ts` - Mean Squared Error calculation, symmetry, edge cases
- `MAE.ts` - Mean Absolute Error calculation, symmetry, negative values
- `MAPE.ts` - Mean Absolute Percentage Error, scale independence
- `MSLE.ts` - Mean Squared Logarithmic Error, small values handling
- `CrossEntropy.ts` - Classification loss, out-of-range rejection, edge values
- `HINGE.ts` - Hinge loss, margin-based classification, non-negativity
- `CostsRegistry.ts` - Factory lookup, custom registration, unknown cost
  rejection

**Mutation operators** (`test/mutate/`):

- `AddBackCon.ts` - Backward connection addition, constant neuron skipping,
  focus lists
- `AddSelfCon.ts` - Self-connection addition, output neuron exclusion, memetic
  cleanup
- `ModBias.ts` - Bias modification, constant neuron protection, focus list
  targeting
- `SubConnection.ts` - Connection removal, orphan cleanup, stress testing
- `SubNeuron.ts` - Neuron removal, cascade cleanup, constant neuron removal

**Configuration** (`test/config/`):

- `AdaptiveMutationThresholds.ts` - Defaults, overrides, cross-field validation,
  CLI string parsing
- `EnsembleDiversityConfig.ts` - Defaults, boolean fields, partial overrides
- `StabilityAdaptationConfig.ts` - Defaults, custom values, string parsing
- `WeightRegularisationConfig.ts` - Defaults, boolean fields, partial overrides

**Upgrade module** (`test/Upgrade/`):

- `UpgradeOneTwo.ts` - Version 0→1→2 upgrade path, data preservation, error
  handling
- `UpgradeVersionRouting.ts` - Version parsing, semantic version bumping, full
  upgrade routing
