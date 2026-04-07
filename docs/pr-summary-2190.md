## Summary

Added a lightweight forward-only topology assertion that runs unconditionally after `initialize()`, not gated by `DEBUG`. This ensures all synapses in a forward-only creature satisfy `from < to` in production builds. If the invariant is violated, a `TopologyError` is thrown immediately rather than silently continuing with a corrupt topology. Closes #2190.

## Changes

- **`src/Creature.ts`**: Added `assertForwardOnlyTopology()` public method that iterates over all synapses and verifies `from < to` when `forwardOnly === true`. Called unconditionally after `initialize()`.
- **`test/architecture/ForwardOnlyInitValidation.ts`**: New test file with 4 tests covering backward synapse detection, self-connection detection, valid creature pass-through, and feedback creature no-op behaviour.

## Evidence

The assertion is a single loop over synapses with no allocations — O(n) where n is the number of synapses. It adds negligible overhead to creature initialisation compared to the existing synapse sort and neuron fix operations.

## Test Plan

- `forward-only: initialisation assertion catches backward synapse` — confirms TopologyError is thrown when a backward synapse exists
- `forward-only: initialisation assertion catches self-connection` — confirms TopologyError is thrown for self-connections
- `forward-only: valid creature passes initialisation assertion` — confirms no error for correctly constructed creatures
- `feedback creature: initialisation assertion is a no-op` — confirms the check is skipped for non-forward-only creatures
- All 5356 existing tests continue to pass
