## Summary

Fixed issue #1314: All observations, weights, biases & activations must be finite.

This PR adds comprehensive protection against non-finite values (Infinity, -Infinity, NaN) propagating through the neural network during training. The protection was added at multiple layers to ensure robustness:

### Changes Made

1. **Input validation** (`src/Creature.ts`):
   - Added finite value checks to `activate()` and `activateAndTrace()` methods
   - Input observations are now validated before being processed
   - Clear error messages indicate which input index contains the invalid value

2. **Bias accumulation protection** (`src/propagate/Bias.ts`):
   - Modified `accumulateBias()` to skip non-finite pre-activation values
   - Modified `accumulateBiasBatch4Way()` and `accumulateBiasBatch8Way()` with same protections
   - Non-finite values are silently skipped rather than corrupting the state

3. **Weight accumulation protection** (`src/propagate/Weight.ts`):
   - Modified `accumulateWeight()` to skip non-finite activation and target values
   - Modified `accumulateWeightBatch4Way()` and `accumulateWeightBatch8Way()` with same protections
   - Non-finite calculated weights are also detected and skipped

4. **Activation tracing protection** (`src/architecture/CreatureState.ts`):
   - Modified `NeuronState.traceActivation()` to skip non-finite activation values
   - Prevents corruption of totalActivation, maximumActivation, and minimumActivation statistics

### Design Decisions

- **Graceful handling**: Non-finite values during backpropagation are silently skipped rather than throwing errors. This allows training to continue even when edge cases produce non-finite intermediate values.
- **Early validation**: Input observations are validated immediately and throw clear errors, as these represent data quality issues that should be fixed at the source.
- **DRY principle**: The same protection pattern is applied consistently across all accumulation functions, including batch variants.
- **Performance**: The `Number.isFinite()` check is inexpensive and placed early in the function to avoid unnecessary computation.

## Evidence

Unable to generate screenshot: This is a CLI-only neural network library with no visual interface.

The fix addresses the exact error shown in the issue:
```
Worker processing error: Error: Bias must be a finite number, got -Infinity
    at limitBias (src/propagate/Bias.ts:77:11)
    at accumulateBias (src/propagate/Bias.ts:17:27)
```

The root cause was that non-finite pre-activation values (like Infinity from large weight sums) could produce non-finite bias deltas, which then failed the existing check in `limitBias()`. The fix catches these values earlier, before they corrupt the state.

## Test Plan

Added comprehensive test suite in `test/propagate/FiniteValueProtection.ts` with 20 test cases:

### Existing protection verification (6 tests)
- `limitBias - rejects positive Infinity target bias`
- `limitBias - rejects negative Infinity target bias`
- `limitBias - rejects NaN target bias`
- `limitWeight - rejects positive Infinity target weight`
- `limitWeight - rejects negative Infinity target weight`
- `limitWeight - rejects NaN target weight`

### Bias accumulation handling (4 tests)
- `accumulateBias - handles Infinity pre-activation value gracefully`
- `accumulateBias - handles -Infinity pre-activation value gracefully`
- `accumulateBias - handles NaN pre-activation value gracefully`
- `accumulateBias - handles Infinity target pre-activation value gracefully`

### Weight accumulation handling (4 tests)
- `accumulateWeight - handles Infinity activation gracefully`
- `accumulateWeight - handles -Infinity activation gracefully`
- `accumulateWeight - handles NaN activation gracefully`
- `accumulateWeight - handles Infinity target value gracefully`

### Activation tracing handling (3 tests)
- `NeuronState.traceActivation - handles Infinity gracefully`
- `NeuronState.traceActivation - handles -Infinity gracefully`
- `NeuronState.traceActivation - handles NaN gracefully`

### Integration tests (3 tests)
- `Creature.propagate - handles extreme activation values without crashing`
- `Training - rejects non-finite input observations`
- `Training - rejects NaN input observations`

All 1883 existing tests continue to pass, confirming no regression.
