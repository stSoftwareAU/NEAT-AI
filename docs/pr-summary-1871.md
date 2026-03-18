## Summary

Diagnostic tests that measure and verify gradient accumulation behaviour for
neurons with varying connectivity in NEAT topologies. Closes #1871.

In `TopologicalBackpropagation.ts`, error signals from multiple downstream paths
are summed, not averaged (Issue #1651). These tests quantify the resulting
gradient scaling imbalance for neurons with different fan-out counts.

## Evidence

Tests exercise real backpropagation passes and assert on measurable outcomes:

- **Fan-out gradient scaling**: A neuron feeding 20 downstream paths accumulates
  more error than one feeding 1 path (gradient summing confirmed).
- **Weight update magnitude**: High fan-out branches produce larger weight
  updates than low fan-out branches in the same network.
- **Error ratio scaling**: Error accumulation scales monotonically with fan-out
  count (tested at fan-out 1, 3, and 10).
- **Convergence comparison**: Both uniform and skewed topologies converge, with
  error reduction exceeding 10% in both cases.
- **Large creature statistics**: 561-neuron, 13,905-synapse creature processes
  real training data; all gradient values remain finite with measurable spread.
- **Extreme fan-out stability**: 50-downstream fan-out produces finite weights,
  biases, and outputs after 20 training iterations.
- **Symmetry verification**: Neurons with identical fan-out and weights
  accumulate equal error (within 1% tolerance).

## Test Plan

- Added `test/propagate/GradientAccumulationScaling.ts` with 7 tests:
  1. Fan-out gradient scaling: 1 vs 20 downstream neurons
  2. Weight update magnitude: high vs low fan-out
  3. Convergence: uniform vs skewed topology
  4. Large creature gradient statistics (using existing test fixtures)
  5. Error ratio scales with fan-out count (1, 3, 10)
  6. Extreme fan-out (50) produces finite gradients
  7. Symmetric fan-out yields similar error
- All 4669 tests pass via `./quality.sh`
