## Summary

Feasibility analysis of WASM-resident creature topology to amortise
serialisation costs. Closes #1642.

**Recommendation: Defer.** The investigation found that WASM-resident topology
would not deliver meaningful gains because:

1. The CompiledNetwork pattern relies on a high amortisation ratio
   (100–10,000:1) that mutable topology cannot achieve (~3–5:1)
2. Structural mutations require index rewriting and array resizing — as
   expensive as recompilation
3. Dual-state synchronisation (JS objects for UUIDs + WASM linear memory for
   computation) introduces high correctness and maintenance risk
4. TypeScript-level algorithmic improvements (#1583, #1584, #1586, #1587, #1641,
   #1644) consistently deliver 10–50%+ gains with far less effort

The document recommends continuing TypeScript-level optimisations and
considering typed array topology as an intermediate step before revisiting WASM
residency.

## Evidence

This is a research/investigation task — no code changes, only a design document.
The analysis references benchmark data from four prior WASM migration
investigations (#1630–#1633) all conducted on Apple M4 Pro with Deno 2.7.x.

Key data points from prior benchmarks:

| Investigation                    | Serialisation Cost | Computation Cost | Ratio                       |
| -------------------------------- | ------------------ | ---------------- | --------------------------- |
| Breeding (#1632, medium)         | 23 ms              | 48 µs            | 480:1                       |
| AddConnection (#1631)            | 70.5 µs            | 1.4 µs           | 50:1                        |
| Compatibility (#1633, cache hit) | N/A                | 66 ns            | Already optimal             |
| Backprop (#1630)                 | ~15 µs             | 4.3 ms           | 0.003:1 (compute-dominated) |

## Test Plan

- No code changes — design document only
- Verified document renders correctly and uses Australian English spelling
- Document added at `docs/WASM_RESIDENT_TOPOLOGY.md`
