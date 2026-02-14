## Summary

Replace random learning rate initialisation (`random()^3`) with a sensible fixed
default (0.01) and add a warm restart learning rate strategy. Closes #1437.

### Changes

- **Sensible default learning rate**: Changed the default from
  `rng.random() * rng.random() * rng.random()` (heavily biased towards tiny
  values, mean ~0.05) to a fixed `0.01`. This makes backpropagation convergence
  predictable and effective without requiring explicit configuration.
- **Warm restart strategy**: Added `warm_restart` as a fourth learning rate
  strategy. It decays the learning rate within each period using the existing
  decay factor, then resets to `initialLearningRate` at the start of each new
  period. This helps escape local minima by periodically boosting the learning
  rate.
- **`warmRestartPeriod` parameter**: New configuration field controlling the
  number of iterations between warm restarts (default: 10, minimum: 2).
- **Updated strategy randomisation**: The random strategy pool now includes
  `warm_restart` with a 20% probability (decay: 30%, adaptive: 25%,
  warm_restart: 20%, fixed: 25%).

## Evidence

This is a backend/algorithm change with no visual output. Verified via:

- All 3589 tests pass (`./quality.sh` exit code 0)
- 10 new unit tests covering default learning rate, warm restart behaviour,
  period clamping, and strategy selection
- All 52 existing backpropagation config tests continue to pass with no
  modifications

## Test Plan

- Added `test/propagate/LearningRateScheduling.ts` with 10 tests:
  - `default learning rate is 0.01` - verifies sensible default
  - `default is consistent across calls` - verifies deterministic default
  - `explicit learningRate still respected` - backwards compatibility
  - `warm_restart is a valid strategy` - type/config acceptance
  - `warm_restart decays then resets` - core restart behaviour
  - `warm_restart with default period` - default period (10) and reset at
    boundary
  - `warm_restart period is clamped` - minimum period of 2
  - `warm_restart rate stays positive` - rate stays within bounds across 30
    iterations
  - `warm_restart included in random strategy pool` - random selection includes
    warm_restart
  - `explicit strategy overrides default` - all four strategies can be
    explicitly set
