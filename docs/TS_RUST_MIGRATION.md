# TypeScript to Rust Migration Milestone

## Overview

This milestone tracks the incremental migration of NEAT-AI components from
TypeScript to Rust/WASM. It is informed by the extensive WASM performance
research series (#1630–#1633, #1639, #1642) which established that:

1. **Tight numerical loops** are already successfully migrated to WASM
   (activation, forward pass, error distribution, scoring)
2. **Graph-structure operations** cannot be directly migrated due to the
   serialisation wall (converting `Map<string, Neuron>` to flat arrays consumes
   99%+ of end-to-end time)
3. **Architectural changes** are required to unlock further migration
   opportunities

## Current WASM Coverage

The following components are already in Rust/WASM:

| Component            | Module                                                  | Reference |
| -------------------- | ------------------------------------------------------- | --------- |
| Activation functions | `wasm_activation/src/squash.rs`                         | —         |
| Forward pass         | `wasm_activation/src/accumulate.rs`                     | —         |
| Error distribution   | `wasm_activation/src/elastic_distribution.rs`           | #1377     |
| Predictive coding    | `wasm_activation/src/pc_inference.rs`, `pc_learning.rs` | —         |
| Score computation    | `wasm_activation/src/` (multiple)                       | #1011     |
| Training state       | `wasm_activation/src/training_state.rs`                 | —         |

## Migration Roadmap

### Phase 1: Foundation (Prerequisite)

These changes restructure the TypeScript-side data representation to make future
WASM migration viable:

1. **Typed array topology** (#1957) — Replace JS object topology with typed
   arrays (`Float64Array`, `Uint32Array`, `Uint8Array`). This makes
   serialisation to WASM a `memcpy` instead of field-by-field marshalling.
   Estimated effort: 2–3 weeks.

2. **Integer neuron IDs** (#1958) — Replace UUID strings with integer
   identifiers. Eliminates the UUID→index mapping overhead that dominates
   serialisation cost. This is a fundamental architectural change affecting
   nearly every module.

### Phase 2: Selective Migration

With typed array topology in place, specific operations become viable WASM
migration candidates:

3. **Selective WASM residency** (#1959) — Migrate read-heavy topology operations
   (validation, connection scanning, dependency analysis) to Rust/WASM.

4. **Batch API design** (#1960) — Group multiple operations into single WASM
   calls to amortise boundary crossing overhead (~100–500 ns per call).

5. **Topology validation in Rust** (#1961) — Migrate forward-only checks, cycle
   detection, and structural integrity validation to WASM.

## What Should NOT Be Migrated

The performance research established that these categories are not suitable for
WASM migration:

- **Orchestration code** (NEAT loop, breeding selection, mutation scheduling) —
  non-numerical; TypeScript is appropriate
- **Cache-dominated paths** (compatibility scoring at 66 ns per LRU hit) —
  already faster than any WASM path
- **Trivially fast operations** (<2 µs in TypeScript) — WASM boundary crossing
  overhead alone is a significant fraction
- **Graph surgery** (compaction, pruning, neuron merging) — dominated by Map/Set
  operations that V8 handles efficiently

## Key References

- `docs/PERFORMANCE_RESEARCH.md` — Comprehensive WASM migration learnings
- `docs/WASM_RESIDENT_TOPOLOGY.md` — Feasibility analysis for WASM-resident
  creature topology
- `docs/PERFORMANCE_TUNING.md` — Performance tuning guide
- #1639 — Parent tracking issue for WASM performance series
- #1642 — WASM-resident topology investigation
