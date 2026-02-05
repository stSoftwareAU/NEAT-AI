## Summary

Implements weight regularisation during mutation to reduce brittleness in neural networks (Issue #1309). This is part of the "Brilliant but Brittle" initiative.

Weight mutations can produce extreme values that create near-constant outputs, amplify noise excessively, or cause saturation in downstream neurons. This PR adds regularisation to prevent these issues.

### Changes

1. **New Configuration** (`src/config/WeightRegularisationConfig.ts`):
   - `enabled`: Toggle regularisation on/off (default: true)
   - `maxAbsoluteWeight`: Hard limit on weight magnitude (default: 100)
   - `maxWeightChange`: Maximum change per mutation (default: 10)
   - `l2Strength`: Bias towards smaller weights (default: 0.1)
   - `preferSmallChanges`: Prefer smaller mutations (default: true)
   - `smallChangeScale`: Scale factor for small change preference (default: 0.5)

2. **Enhanced ModWeight** (`src/mutate/ModWeight.ts`):
   - Added soft constraints with L2-style regularisation
   - Added hard limits on absolute weight and change per mutation
   - Implemented small change preference
   - Maintains backward compatibility (works without config)

3. **Configuration Integration**:
   - Added `weightRegularisation` to `NeatArguments`, `NeatOptions`, and `NeatConfig`
   - Mutator now passes config to ModWeight

## Evidence

This is a code change with no visual interface. The feature is verified through comprehensive unit tests.

## Test Plan

Added 11 new tests in `test/mutate/ModWeightRegularisation.ts`:

- `ModWeight - respects maxAbsoluteWeight hard limit`: Verifies weights never exceed the configured maximum
- `ModWeight - respects maxWeightChange hard limit`: Verifies changes per mutation are bounded
- `ModWeight - L2 regularisation biases towards smaller weights`: Verifies L2 regularisation pulls weights toward zero
- `ModWeight - preferSmallChanges reduces mutation magnitude`: Verifies small change preference reduces average mutation size
- `ModWeight - regularisation can be disabled`: Verifies feature can be turned off
- `ModWeight - default config provides sensible regularisation`: Verifies defaults work correctly
- `ModWeight - works without config (backward compatible)`: Verifies backward compatibility
- `ModWeight - clamps extreme initial weights to maxAbsoluteWeight`: Verifies extreme weights are clamped
- `ModWeight - handles negative weights correctly with regularisation`: Verifies negative weights work correctly
- `ModWeight - focus list works with regularisation`: Verifies focus list functionality is preserved
- `ModWeight - returns false when no synapses exist (with config)`: Verifies edge case handling

All existing ModWeight tests continue to pass, ensuring backward compatibility.

## Acceptance Criteria

- [x] TDD: Write failing tests first
- [x] Regularisation strength configurable (`l2Strength`, `smallChangeScale`)
- [x] Hard limits configurable (`maxAbsoluteWeight`, `maxWeightChange`)
- [x] Integration with existing mutation logic
- [x] Backward compatible (opt-in via sensible defaults that are enabled by default)
