## Summary

Implement bias-weight coordination in memetic quantum adjustments (#1331).

Previously, bias and weight quantum adjustments in `tuneRandomize()` were made
independently per neuron. Since a neuron's pre-activation is
`v = b + Σ(w_i * a_i)`, independent changes to bias (Δb) and weights (Δw) can
cancel each other out, wasting parameter space exploration.

This change introduces a coordination phase that detects when bias and weight
changes oppose each other and reduces the smaller opposing force to preserve the
net effect direction. Aligned changes (same direction) pass through unchanged to
reinforce each other.

### Changes

- **New file `src/blackbox/BiasWeightCoordination.ts`**: Coordination module
  with `coordinateBiasWeightAdjustments()` that takes a per-neuron adjustment
  plan and returns coordinated bias/weight values. When opposing changes are
  detected, the smaller opposing force is scaled down by 80% while the larger
  force is preserved.

- **Modified `src/blackbox/FineTune.ts`**: Restructured `tuneRandomize()` into
  three phases:
  1. Compute candidate bias adjustments per neuron
  2. Compute candidate weight adjustments grouped by target neuron
  3. Coordinate bias and weight adjustments per neuron before applying

## Evidence

This is a backend/algorithm change with no UI. Verified by:

- All 2004 existing tests pass (including FineTune, QuantumAdjust, and
  MemeticAncestry tests)
- The evolve integration test shows fine-tuning continues to improve fitness
  correctly
- `./quality.sh` passes cleanly

## Test Plan

- Added `test/blackbox/BiasWeightCoordination.ts` with 13 unit tests:
  - No changes: returns unchanged values
  - Bias-only change: passes through
  - Weight-only change: passes through
  - Both bias and weights change: ensures net effect
  - Distributes change across bias and weights
  - Preserves all synapse metadata (fromUUID, toUUID)
  - Handles single synapse coordination
  - Results are finite numbers
  - No synapses with changed bias works
  - Unchanged synapses not forced to change
  - Reduces opposing changes to prevent cancellation (bias smaller)
  - Aligned changes pass through unchanged
  - Reduces opposing weights when bias is larger force
