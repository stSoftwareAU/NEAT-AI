## Summary

Implement `computeLayerAssignments()` to compute neuron layer/level assignments
from network topology. Each neuron is assigned a layer representing its depth
from input neurons (longest path). This is the foundation for generating
synthetic synapses between adjacent layers. Closes #1920.

- Input and constant neurons are assigned to layer 0
- Hidden neurons are assigned layers based on longest path from inputs using
  Kahn's algorithm
- Output neurons are always placed in the final layer
- Recurrent connections (back-edges) and self-loops are gracefully ignored
- Handles edge cases: disconnected neurons, skip connections, cycles, no hidden
  neurons

## Evidence

All 16 unit tests pass covering:

- Simple chain, diamond, and asymmetric topologies
- Skip connections with longest-path verification
- Self-loops and recurrent connections
- Constant neurons
- Disconnected hidden neurons
- No hidden neurons (direct input-to-output)
- Production-sized topology (100 inputs, 800 hidden, 50 outputs)
- Consecutive layer numbering validation
- All-neurons-assigned-exactly-once invariant

## Test Plan

- Added `test/propagate/LayerAssignment.ts` with 16 tests
- Added `src/propagate/LayerAssignment.ts` implementation
