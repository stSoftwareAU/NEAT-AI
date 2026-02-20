## Summary

Implement the core Predictive Coding inference engine as a TypeScript prototype.
This adds the iterative settling algorithm where latent variables are updated to
minimise prediction error energy — the "fast" inner loop of the PC framework.
Closes #1554.

### What was added

1. **`src/predictiveCoding/PredictionErrorComputation.ts`** — Computes
   per-neuron top-down predictions, prediction errors, and total energy:
   - `computePrediction()`: calculates predicted activation via weighted sum
     through inward connections + squash function
   - `computePredictionErrors()`: returns per-neuron prediction/error/latent
     state for all non-input neurons
   - `computeTotalEnergy()`: sums squared errors (E = 1/2 * sum of epsilon^2)

2. **`src/predictiveCoding/PredictiveCodingInference.ts`** — The iterative
   inference (settling) loop:
   - Clamps input neurons to observed data
   - Initialises hidden neuron latents from forward predictions
   - Optionally clamps output neurons to supervised targets
   - Iteratively updates hidden neuron latents via gradient descent on
     prediction error energy
   - Supports early stopping when energy converges below threshold
   - Stores final inference state in NeuronState PC fields (prediction,
     predictionError, latentValue)
   - Non-destructive: does not modify creature topology or synapse weights

### Key design decisions

- **Arbitrary topology support**: Uses `creature.inwardConnections()` and
  `creature.outwardConnections()` rather than strict layer ordering, working
  with any NEAT topology.
- **Gradient computation**: For each hidden neuron, the gradient includes both
  its own prediction error and the downstream error contributions weighted by
  connection weights and squash derivatives.
- **Squash function reuse**: Uses existing `Activations.find()` and the
  `derivative()` method from the activation function implementations.
- **Forward-pass initialisation**: Hidden latents are initialised from forward
  predictions (top-down), which means zero initial energy when no targets are
  provided — energy only needs to decrease when supervised targets create a
  mismatch.

## Evidence

This is a purely backend/algorithmic change with no UI component. Evidence is
provided through comprehensive unit tests verifying correct behaviour.

## Test Plan

### PredictionErrorComputation tests (8 tests)

- `computePrediction` for IDENTITY squash neuron
- `computePrediction` for output neuron
- `computePrediction` with LOGISTIC (non-linear) squash
- `computePredictionErrors` returns per-neuron errors with correct values
- `computeTotalEnergy` sums squared errors correctly
- No hidden neurons produces only output errors
- Zero errors give zero energy
- Input neurons return their latent value as prediction

### PredictiveCodingInference tests (10 tests)

- Energy decreases monotonically with supervised targets
- Early stopping when energy falls below threshold
- Does not modify creature topology (neuron count, synapse count, weights)
- Input neurons remain clamped throughout inference
- Returns prediction errors for non-input neurons only
- No hidden neurons — handles edge case gracefully
- Single hidden neuron converges correctly
- Stores inference state in NeuronState PC fields
- LOGISTIC squash — energy still decreases monotonically
- Target outputs — output latents are clamped to target values
