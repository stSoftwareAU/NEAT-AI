## Summary

Implements configurable quantum step size based on training progress for memetic fine-tuning (#1330).

Previously, the quantum step size (`MIN_STEP = 0.000_000_1`) was a fixed constant used throughout fine-tuning. This change introduces adaptive step sizing that uses larger steps when far from the optimum (large error magnitude) and smaller steps when close to convergence.

### Key changes:
- **New `MemeticStepConfig`**: Configuration interface with `minStepSize`, `maxStepSize`, and `errorScale` fields, following the established config pattern (interface, Required type, DEFAULT constant)
- **New `calculateAdaptiveStepSize()` function**: Computes step size as `minStepSize * (1 + errorScale * |score|)`, capped at `maxStepSize`
- **Updated `quantumAdjust()`**: Accepts an optional `stepSize` parameter; when omitted, falls back to the existing `MIN_STEP` constant for backward compatibility
- **Updated `fineTuneImprovement()`**: Accepts optional `RequiredMemeticStepConfig`, calculates adaptive step size from the fittest creature's score, and passes it through to `tuneRandomize` and `quantumAdjust`
- **Config integration**: `memeticStep` is available in `NeatOptions` with CLI string coercion support, parsed in `createNeatConfig()`, and passed through all production call sites (`Neat.ts`, `FineTunePopulation.ts`, `Retry.ts`)

### Default behaviour:
With default config (`minStepSize: 0.0000001`, `maxStepSize: 0.001`, `errorScale: 10`):
- Score near 0 (converged): step ~ `0.0000001` (minimum, same as before)
- Score of -0.05: step ~ `0.0000006`
- Score of -0.5: step ~ `0.0000006` (capped at max)

This provides faster exploration when far from the optimum and finer adjustments near convergence, without changing behaviour for well-converged creatures.

## Evidence

This is a backend enhancement with no UI changes. Correctness is verified through unit tests:
- All 2003 existing + new tests pass via `./quality.sh`
- No existing tests were modified or removed

## Test Plan

New test file: `test/blackbox/MemeticStepSize.ts` with 12 tests:
- `quantumAdjust - uses custom step size`: Verifies quantisation uses the provided step size
- `quantumAdjust - default step size matches MIN_STEP`: Confirms backward compatibility
- `quantumAdjust - larger step produces coarser quantisation`: Statistical test confirming coarser granularity
- `quantumAdjust - no change when diff below step size`: Verifies threshold behaviour with custom step
- `calculateAdaptiveStepSize - returns bounded step`: Verifies minimum and positive error scaling
- `calculateAdaptiveStepSize - respects maxStepSize cap`: Verifies upper bound capping
- `calculateAdaptiveStepSize - scales with error magnitude`: Verifies monotonic scaling
- `NeatConfig - memeticStep defaults applied`: Verifies default config values
- `NeatConfig - memeticStep custom values`: Verifies custom config override
- `NeatConfig - memeticStep partial overrides`: Verifies partial override merging
- `NeatConfig - memeticStep validation: maxStepSize < minStepSize`: Verifies cross-field validation
- `NeatConfig - memeticStep string coercion from CLI`: Verifies CLI string-to-number parsing
