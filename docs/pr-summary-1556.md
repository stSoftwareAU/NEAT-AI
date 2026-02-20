## Summary

Integrate Predictive Coding (PC) training mode into `trainDir()` and `evolveDir()` as an optional training strategy. When `predictiveCoding.enabled = true`, creatures are trained using PC's local Hebbian learning rules instead of standard backpropagation. The existing training behaviour is completely unchanged when PC is disabled (the default). Closes #1556.

### Changes

- **`src/predictiveCoding/PredictiveCodingTrainer.ts`** (new): Orchestrates the full PC training loop — for each iteration, runs PC inference (settling) on every sample, accumulates weight/bias gradients, applies averaged Hebbian updates, and checks early stopping.
- **`src/architecture/Training.ts`**: `trainDir()` now checks `options.predictiveCoding.enabled` and delegates to the PC trainer when true, returning the same `TrainingResult` interface for compatibility.
- **`src/config/TrainOptions.ts`**: Added `predictiveCoding` field to `TrainArguments` so PC config flows through the worker thread pipeline.
- **`src/NEAT/Neat.ts`**: Passes `predictiveCoding` config from NeatConfig through to worker train options.
- **`src/predictiveCoding/PredictionErrorComputation.ts`**, **`PredictiveCodingInference.ts`**, **`PredictiveCodingLearning.ts`**: Fixed aggregate activation guard — `IF`, `MAXIMUM`, `MINIMUM`, etc. implement `NeuronActivationInterface` (not `ActivationInterface`) and lack a scalar `squash()` method. These are now treated as identity for PC inference.

### Architecture

The integration follows the same pattern as the existing training pipeline:
1. `evolveDir()` creates workers → workers call `trainDir()` → `trainDir()` checks PC config
2. PC training is purely a training strategy — scoring, selection, breeding, and mutation remain unchanged
3. No worker code changes needed — PC config flows through `TrainOptions`

## Evidence

This is a backend/training feature with no web interface. Evidence is provided by test results:
- All 4228 existing tests pass unchanged (verifying backward compatibility)
- 7 new integration tests verify PC training correctness

## Test Plan

New tests in `test/predictiveCoding/PredictiveCodingTrainer.ts`:
- `PC trainer returns finite error for simple dataset` — verifies PC training loop produces valid results
- `trainDir delegates to PC trainer when enabled` — verifies the integration point
- `trainDir uses standard backprop when PC is disabled` — verifies backward compatibility
- `trainDir without PC config uses standard backprop` — verifies no PC config = unchanged behaviour
- `PC training reduces error on simple regression task` — verifies PC can train a regression task
- `PC trainer handles single-sample dataset` — edge case coverage
- `PC trainer averageInferenceSteps is within bounds` — verifies inference step metrics
