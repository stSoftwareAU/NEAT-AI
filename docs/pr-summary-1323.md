## Summary

Implements adaptive fine-tuning population sizing based on improvement rate
(#1323).

Previously, the fine-tuning population size was calculated using a fixed
heuristic (20% of population or number of dead creatures). This change
dynamically adjusts the size based on how successful fine-tuning has been in
recent generations:

- **High success rate**: Increases fine-tune population size (up to 40% of
  population) to allocate more resources to a productive strategy
- **Low success rate**: Decreases fine-tune population size (down to 10% of
  population) to reduce wasted computation
- **No data yet**: Uses the base fraction (20%, matching the original heuristic)
  as a starting point

### Architecture

1. **`FineTunePopulationConfig`** (`src/config/FineTunePopulationConfig.ts`):
   New config with `minPopulationFraction`, `maxPopulationFraction`,
   `basePopulationFraction`, and `successRateWindow` - follows the established
   config pattern (interface, Required type, defaults)

2. **`AdaptiveFineTuneTracker`** (`src/blackbox/AdaptiveFineTuneTracker.ts`):
   Tracks fine-tuning success rate using a rolling window and calculates
   adaptive population sizes via linear interpolation between min and max
   fractions

3. **Integration into evolution loop** (`src/NEAT/Neat.ts`): Records whether the
   fittest creature in each generation originated from fine-tuning (approach tag
   "fine"), feeding outcomes into the tracker

4. **`FindTunePopulation`** (`src/blackbox/FineTunePopulation.ts`): Uses the
   tracker's `calculatePopSize()` instead of the fixed heuristic when the
   tracker is available

### Backward Compatibility

The adaptive tracker is always created (initialised with the default config).
The default `basePopulationFraction` of 0.2 matches the original
`populationSize / 5` heuristic, so first-generation behaviour is unchanged. The
dead-slots floor from the original heuristic is preserved.

## Evidence

This is a backend/algorithm change with no UI component. All functionality is
verified through unit tests. The evolution integration test (`test/Evolve.ts`)
passes successfully, confirming the adaptive tracker works correctly within the
full evolution loop.

## Test Plan

### Config tests (`test/config/FineTunePopulationConfig.ts`) - 8 tests

- Defaults applied when not specified
- Custom values override defaults
- Partial overrides merge with defaults
- String values coerced from CLI
- maxPopulationFraction < minPopulationFraction throws
- basePopulationFraction below min throws
- basePopulationFraction above max throws
- Default values are sensible

### Tracker tests (`test/blackbox/AdaptiveFineTuneTracker.ts`) - 12 tests

- Success rate is NaN with no outcomes
- Success rate tracks correctly
- All successes gives rate 1.0
- All failures gives rate 0.0
- Rolling window evicts old outcomes
- Outcome count respects window size
- calculatePopSize uses base fraction when no data
- calculatePopSize increases with high success rate
- calculatePopSize decreases with low success rate
- Dead slots floor ensures minimum population
- calculatePopSize bounded between min and max fractions
- Mixed outcomes produce intermediate size
