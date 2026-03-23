## Summary

Migrate topology validation logic (structural integrity, cycle detection, forward-only checks) from TypeScript to Rust/WASM. Closes #1961.

Two new WASM-exported functions added to `topology_ops.rs`:

- **`validate_structural_integrity`** — validates connection counts per neuron type (input/constant/hidden), bias finiteness, synapse target validity, and IF neuron synapse type requirements (condition/positive/negative). Returns error code and neuron index.
- **`detect_cycles`** — uses Kahn's algorithm to detect cycles among non-input neurons, including self-loops. Returns 0 (acyclic) or 1 (cycles present).

Both functions operate on typed arrays from `TypedTopology`, enabling zero-copy WASM boundary crossing. TypeScript fallback implementations are provided for environments without WASM.

Integration into `CreatureValidate.ts`: forward-only creatures now run WASM-accelerated topology validation, structural integrity checks, and cycle detection as part of the standard validation pipeline.

## Evidence

- All 29 Rust unit tests pass (topology_ops module)
- All 27 new TypeScript tests pass (`test/wasm/WasmStructuralValidation.ts`)
- All 4909 existing tests pass with no regressions
- WASM and TypeScript implementations produce identical results (verified by comparison tests)

## Test Plan

- Added `test/wasm/WasmStructuralValidation.ts` with 27 tests covering:
  - Structural integrity: valid creatures, synapse targeting input, constant with inward, hidden no inward/outward, non-finite bias, NaN bias, IF neuron too few inward, IF missing condition/positive/negative
  - Cycle detection: acyclic graphs, cycles, self-loops, longer cycles, empty graphs
  - TypedTopology integration methods
  - CreatureValidate integration for forward-only creatures
  - WASM vs TypeScript result matching
- Added Rust unit tests in `topology_ops.rs` for both `validate_structural_integrity` and `detect_cycles`
