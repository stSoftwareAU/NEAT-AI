## Summary

Replace JS object-based topology representation with typed arrays for WASM-compatible serialisation. Closes #1957.

Introduces `TypedTopology` — a typed array snapshot of a creature's topology using:
- `Float64Array` for weights and biases
- `Uint32Array` for connectivity (from/to indices)
- `Uint8Array` for squash types, synapse types, and constant flags

The WASM activation path (`WasmActivation.fromCreature`) now uses `TypedTopology.toWasmBinary()` instead of field-by-field object traversal, making serialisation closer to a bulk copy. The typed topology is cached on the Creature instance and invalidated on structural changes.

This is the recommended intermediate step from the WASM-resident topology feasibility analysis (#1642, `docs/WASM_RESIDENT_TOPOLOGY.md` Section 5.2) and the first prerequisite of the TS-Rust migration milestone.

## Evidence

- `toWasmBinary()` output is byte-identical to the legacy `compileCreatureToWasm()` — verified by direct comparison tests
- All 4849 existing tests pass with the typed topology integration
- WASM activation path updated to use typed topology without any behavioural changes

## Test Plan

- Added 17 tests in `test/architecture/TypedTopology.ts`:
  - Array type verification (Float64Array, Uint32Array, Uint8Array instances)
  - Metadata dimensions match creature
  - Bias, squash type, weight, connectivity, and synapse type correctness
  - Constant neuron handling
  - Multiple topologies (empty hidden layer, multi-hidden, IF aggregate)
  - `toWasmBinary()` byte-identical comparison with legacy `compileCreatureToWasm()`
  - `Creature.buildTypedTopology()` caching and invalidation
