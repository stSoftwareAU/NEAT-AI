## Summary

Added diagnostic tests that measure and verify gradient accumulation behaviour
for neurons with varying connectivity in NEAT topologies. These tests quantify
how gradient summing (not averaging) in `TopologicalBackpropagation.ts` causes
neurons with high fan-out to receive proportionally larger gradient signals, and
demonstrate the limited gradient reach in large saturated networks. Closes
#1871.

## Evidence

Test output demonstrates key findings:

- **Fan-out scaling**: A neuron with 20 downstream connections receives 20x the
  weight update of one with 1 connection (exact linear scaling confirmed).
- **Weight update ratio**: In mixed-connectivity networks, high fan-out neurons
  show ~123x larger weight updates than low fan-out neurons.
- **Convergence**: Both uniform and skewed topologies converge, with uniform
  showing slightly better error reduction (19.8% vs 14.9%).
- **Large creature**: Only 0.5% of neurons in the 2015-neuron creature receive
  any gradient signal, with a 10,079x dynamic range among those that do —
  confirming the gradient accumulation scaling challenge from Issue #1869.

## Test Plan

- `test/propagate/GradientAccumulationScaling.ts`:
  - Fan-out gradient scaling test (1 vs 20 downstream connections)
  - Weight update magnitude comparison (mixed high/low fan-out network)
  - Convergence comparison between uniform and skewed topologies
  - Large creature gradient statistics using existing test fixture
- All 4666 tests pass via `./quality.sh`
