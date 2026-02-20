## Summary

Implement the core Predictive Coding inference engine as a TypeScript prototype.
This adds the "fast" inner loop where latent variables iteratively settle to
minimise prediction error energy, serving as both the functional implementation
and a reference for the later Rust/WASM optimisation. Closes #1554.

### New modules

- **`src/predictiveCoding/PredictionErrorComputation.ts`** - Computes per-neuron
  predictions, prediction errors, and total energy for the PC inference loop.
  Each neuron's prediction is computed from its inward connections using the
  existing squash functions.

- **`src/predictiveCoding/PredictiveCodingInference.ts`** - Implements the
  iterative settling algorithm:
  1. Clamp input neurons to observed data
  2. Initialise hidden activations via forward pass
  3. Optionally clamp output neurons to targets
  4. Iteratively update hidden latents to minimise energy
  5. Store settled state in NeuronState (non-destructive)

### Key design decisions

- Works with arbitrary NEAT topologies (not just feedforward layers)
- Respects existing squash functions per neuron (with derivative support)
- Uses shared (symmetric) weights as specified in the architecture design
- Inference only updates latent values; does not modify creature topology
- Stores results in NeuronState PC fields added in #1553

## Evidence

This is a backend/library change with no visual output. Verified by:

- 27 new unit tests all passing
- All 4218 existing tests pass unchanged
- `./quality.sh` passes cleanly (fmt, lint, type-check, tests)

## Test Plan

### PredictionErrorComputation tests (12 tests)

- Prediction for identity neuron equals weighted sum
- Prediction for output neuron uses inward connections
- Error is actual minus predicted
- Input neurons have zero error
- Energy is half sum of squared errors
- Zero error when predictions match activations
- With targets, output error uses target
- Works with TANH squash
- Multiple hidden neurons
- Neuron with bias contributes to prediction
- Energy is always non-negative
- No hidden neurons (direct input-to-output)

### PredictiveCodingInference tests (15 tests)

- Energy decreases over iterations
- Converges on consistent network
- Early stopping when energy below threshold
- Clamps input neurons
- Clamps output neurons to targets
- Stores state in NeuronState
- Does not modify creature topology
- Single hidden neuron
- No hidden neurons
- With TANH squash function
- Respects inferenceSteps limit
- Multiple outputs
- Supervised settling adjusts hidden to reduce error
- Energy monotonically non-increasing with small rate
- Different squash functions are respected
