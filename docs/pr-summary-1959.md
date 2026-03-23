## Summary

Selective WASM residency for read-heavy topology operations. Closes #1959.

With typed array topology (#1957) in place, three read-heavy topology operations
have been migrated to Rust/WASM:

1. **Topology validation** (`validate_topology`) — Forward-only checks: synapse
   sorting, self-connection detection, backward connection detection
2. **Connection availability scanning** (`scan_available_connections`) — Finds
   all available forward-only connection slots using a flat boolean array for
   cache-friendly O(1) lookup in WASM linear memory
3. **Neuron dependency analysis** (`compute_reverse_topological_order`) — Kahn's
   algorithm for reverse topological order (backpropagation ordering)

These functions operate directly on typed arrays from `TypedTopology` via
wasm-bindgen slice passing — no custom binary serialisation required. Each
function has a TypeScript fallback for environments without WASM.

### Architecture

- **Rust WASM functions** in `wasm_activation/src/topology_ops.rs`
- **TypeScript wrappers** in `src/wasm/WasmTopologyOps.ts` with TS fallbacks
- **Convenience methods** on `TypedTopology`: `validateForwardOnly()`,
  `scanAvailableConnections()`, `computeReverseTopologicalOrder()`
- **WASM module loader** updated with function pointers and getters

## Evidence

- All 21 new tests pass, verifying WASM results match existing TypeScript
  implementations
- All 11 Rust unit tests pass (topology_ops module)
- 4869 existing tests pass (1 pre-existing flaky test excluded — temp directory
  cleanup race in DiscoveryRunnerCandidateEvaluation)
- WASM build succeeds with wasm-pack

## Test Plan

- `test/wasm/WasmTopologyOps.ts` — 21 tests:
  - 9 topology validation tests (valid, self-connection, backward, sort errors,
    duplicates, empty, WASM/TS equivalence)
  - 5 connection scanning tests (correct slots, exclusions, constant neuron
    skip, TS equivalence, CreatureTopology equivalence)
  - 7 topological order tests (output-first ordering, input exclusion, TS
    equivalence, constant neuron handling, completeness, empty creature)
- Rust unit tests in `wasm_activation/src/topology_ops.rs` — 11 tests
