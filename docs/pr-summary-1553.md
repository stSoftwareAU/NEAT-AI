## Summary

Add foundational Predictive Coding (PC) data structures, configuration, and types to NEAT-AI. This establishes the type system and configuration that all subsequent PC work depends on. Closes #1553.

### Changes

- **`src/config/PredictiveCodingConfig.ts`** — New config interface with `enabled`, `inferenceSteps`, `inferenceRate`, `learningRate`, `energyThreshold` fields, plus `RequiredPredictiveCodingConfig` type and `DEFAULT_PREDICTIVE_CODING_CONFIG`
- **`src/architecture/PredictionNodeState.ts`** — New interface for per-node PC inference state (`prediction`, `error`, `latent`)
- **`src/architecture/CreatureState.ts`** — Extended `NeuronStateInterface` and `NeuronState` class with optional `prediction`, `predictionError`, `latentValue` fields; reset clears them
- **`src/config/NeatArguments.ts`** — Added `predictiveCoding: RequiredPredictiveCodingConfig` field
- **`src/config/NeatOptions.ts`** — Added partial override to both `NeatOptions` and `NeatOptionsInput` types (with `CoerceNumeric<>` for CLI), added to both Omit lists
- **`src/config/NeatConfig.ts`** — Parse with IIFE pattern using `parseNumber()`; validates `inferenceSteps >= 1`, `inferenceRate > 0`, `learningRate > 0`, `energyThreshold > 0`

## Evidence

This is a backend/config-only change with no visual output. All 4191 tests pass including 19 new tests. The change is fully backward compatible — PC is disabled by default and the optional NeuronState fields are only populated when PC mode is enabled.

## Test Plan

- **`test/config/PredictiveCodingConfig.ts`** — 11 tests covering:
  - Defaults applied when not specified
  - Custom values override defaults
  - Partial overrides merge with defaults
  - String values coerced from CLI
  - `inferenceSteps` must be >= 1 and integer
  - `inferenceRate`, `learningRate`, `energyThreshold` must be > 0
  - Negative values rejected
  - Default values are sensible
  - Disabled by default
- **`test/architecture/PredictionNodeState.ts`** — 3 tests covering type creation with positive, zero, and negative values
- **`test/architecture/NeuronStatePredictiveCoding.ts`** — 4 tests covering:
  - PC fields undefined by default
  - PC fields can be set and read
  - Reset clears PC fields
  - PC fields do not affect existing behaviour
