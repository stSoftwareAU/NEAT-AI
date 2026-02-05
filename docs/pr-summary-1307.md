## Summary

Implements adaptive mutation rate adjustment based on validation stability (Issue #1307), part of the "Brilliant but Brittle" initiative.

### What Changed

This PR introduces a comprehensive stability tracking and adaptive mutation system that:

1. **Tracks mutation stability per creature** (`MutationStabilityTracker`):
   - Records success rate of recent mutations using a rolling window
   - Distinguishes between STABLE, BRITTLE, and FAILED mutation outcomes
   - Tracks per-mutation-type stability (e.g., MOD_WEIGHT vs ADD_NODE)
   - Automatically classifies mutations as brittle based on training/validation score variance

2. **Adjusts mutation rates based on stability** (`AdaptiveMutationRate`):
   - Reduces mutation rate and magnitude for creatures producing brittle offspring
   - Increases exploration for creatures with stable mutations
   - Reduces topology mutation probability (ADD_NODE, ADD_CONN) for brittle creatures
   - Per-mutation-type adaptation (mutation types with poor stability get reduced weights)

3. **Integrates stability into breeding** (`StabilityAwareSelection`):
   - Factors stability into parent selection (stable parents preferred)
   - Adaptive weight adjustment when population is brittle-heavy
   - Population brittleness level calculation

4. **Configurable adaptation parameters** (`stabilityAdaptation` in NeatConfig):
   - `enabled`: Toggle stability adaptation (default: false for backwards compatibility)
   - `stabilityWindowSize`: Rolling window for tracking outcomes (default: 20)
   - `brittlenessThreshold`: When to consider a creature brittle (default: 0.3)
   - `brittleReductionFactor`: Mutation rate reduction for brittle creatures (default: 0.5)
   - `stableBoostFactor`: Mutation rate boost for stable creatures (default: 1.3)
   - `selectionStabilityWeight`: Weight given to stability in parent selection (default: 0.2)
   - `trackPerMutationType`: Per-type adaptation (default: false)

### Files Added
- `src/NEAT/MutationStabilityTracker.ts` - Core stability tracking
- `src/NEAT/AdaptiveMutationRate.ts` - Adaptive mutation rate calculation
- `src/breed/StabilityAwareSelection.ts` - Stability-aware parent selection
- `src/config/StabilityAdaptationConfig.ts` - Configuration interface and defaults

### Files Modified
- `src/config/NeatArguments.ts` - Added stabilityAdaptation config type
- `src/config/NeatOptions.ts` - Added stabilityAdaptation option
- `src/config/NeatConfig.ts` - Added parsing for stabilityAdaptation

## Evidence

This is a functional enhancement to the evolution system, not a UI change or performance optimisation. The implementation follows TDD with comprehensive tests verifying:

- Stability metric tracking accuracy
- Mutation rate adjustment formulas
- Parent selection weight calculations
- Configuration parameter validation

## Test Plan

Added 33 new tests across 3 test files:

### MutationStabilityTracker tests (13 tests)
- `test/mutate/MutationStabilityTracker.ts`
- Tests for tracking stable, brittle, and failed mutations
- Rolling window behaviour
- Per-mutation-type stability tracking
- Score variance-based brittleness detection
- Mutation magnitude multiplier calculation
- Stability score normalisation

### AdaptiveMutationRate tests (11 tests)
- `test/mutate/AdaptiveMutationRate.ts`
- Tests for mutation rate reduction/boost
- Min/max rate bounds
- Topology mutation weight adjustment
- Weight/bias preference for brittle creatures
- Per-type stability adaptation
- Null/empty tracker handling

### StabilityAwareSelection tests (9 tests)
- `test/breed/StabilityAwareSelection.ts`
- Tests for selection weight calculation
- Fitness score adjustment
- Population brittleness level
- Adaptive weight adjustment
- Stability ranking

All tests pass with `./quality.sh`.

## Mutation Rate Adjustment Formula

The mutation rate adjustment follows this formula:

```
For brittle creatures (brittlenessRate >= threshold):
  adjustedRate = baseRate * (1 - brittlenessRate * (1 - brittleReductionFactor))

For stable creatures (stabilityRate >= stableBoostThreshold):
  adjustedRate = baseRate * (1 + stabilityRatio * (stableBoostFactor - 1))

Final rate is clamped to [minRate, maxRate].
```

## Usage Example

```typescript
const config = createNeatConfig({
  stabilityAdaptation: {
    enabled: true,
    brittlenessThreshold: 0.3,
    brittleReductionFactor: 0.5,
    selectionStabilityWeight: 0.2,
  },
});
```

The feature is disabled by default to maintain backwards compatibility. Enable it by setting `stabilityAdaptation.enabled: true`.
