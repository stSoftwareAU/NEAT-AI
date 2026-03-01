## Summary

Add a comprehensive performance optimisation guide (`docs/performance-guide.md`)
that captures learnings from systematic WASM migration investigations and
successful TypeScript-level optimisations. Closes #1640.

The guide covers four key areas:

1. **When WASM migration works** — tight numerical loops (activation, forward
   pass, error distribution, SIMD) where arithmetic intensity exceeds
   marshalling cost
2. **When WASM migration does NOT work** — graph-structure manipulation (#1632),
   trivially fast operations (#1631, #1633), cache-dominated paths (#1633), and
   sequential graph traversal (#1630)
3. **What DOES work** — batching (33–51%, #1583), redundancy removal (8–11%,
   #1584), better cloning (2.4–3.5x, #1586), better algorithms (9–12%, #1587)
4. **The serialisation wall** — JS↔WASM boundary crossing cost is the primary
   barrier; future gains require architectural changes (WASM-resident state)

All benchmark data is sourced from the referenced issues/PRs with concrete
numbers from Apple M4 Pro benchmarks.

## Evidence

This is a documentation-only change with no visual or performance impact.
The tests verify that the code behaviours described in the guide (WASM
activation, shallowClone equivalence, creature validation) remain accurate.

## Test Plan

- Added `test/docs/PerformanceGuide.ts` with 5 tests verifying documented
  behaviours:
  - WASM activation initialises and is available for numerical operations
  - WASM activation produces correct results via LOGISTIC squash
  - `shallowClone()` produces equivalent output to JSON round-trip cloning
  - `shallowClone()` preserves neuron and synapse counts
  - Creatures remain valid after construction and export/reconstruct cycle
- All 4293 tests pass via `./quality.sh`
