## Summary

Systematically evaluated 7 operations in the evolveDir pipeline against the WASM
migration decision framework from PERFORMANCE_RESEARCH.md. All evaluations
yielded negative results — no new WASM migration opportunities were identified.
Additionally assessed WASM-resident creature state feasibility and found it not
recommended at this time due to unfavourable effort-to-benefit ratio. Closes
#2278.

### Key Findings

- **Breeding (50–60% of generation time):** NOT a WASM candidate — graph
  manipulation with Map/Set data structures, blocked by the serialisation wall
- **Fitness evaluation (13–19%):** ALREADY in WASM — batch loss functions
  (`mseSumBatchPacked` etc.) cover all 6 cost types for forward-only creatures
- **Genetic compatibility:** NOT a WASM candidate — cache-dominated at ~70 ns
  per hit, already below WASM boundary crossing cost
- **Mutation (4–10%):** NOT a WASM candidate — O(1) scalar operations per
  mutation, trivially fast at ~1–2 µs
- **De-duplication (6–9%):** NOT a WASM candidate — Bloom filter + Set
  operations on UUID strings
- **Speciation (<1%):** NOT a WASM candidate — negligible time, architecture
  bucketing with string operations
- **WASM-resident creature state:** Not recommended — estimated 13–20 weeks of
  development for uncertain 20–40% breeding improvement; better alternatives
  exist in TypeScript-level algorithmic improvements

### Negative Result Documentation

All findings are documented in `docs/PERFORMANCE_RESEARCH.md` with:

- Per-operation decision framework evaluation tables
- Benchmark data (timings from Apple M2 Ultra, Deno 2.7.12)
- WASM-resident creature state feasibility assessment with estimated effort,
  benefit, and architectural requirements
- Future trigger conditions for revisiting the assessment

## Evidence

This is a performance research issue with negative results. No visual output
changes were made.

**Benchmark results** (Apple M2 Ultra, Deno 2.7.12):

| Operation                  | Time    | WASM Candidate?                      |
| -------------------------- | ------- | ------------------------------------ |
| Breed (small, 20n)         | ~382 µs | NO — serialisation wall              |
| Breed (medium, 80n)        | ~6.0 ms | NO — serialisation wall              |
| JS Cost MSE (10 out)       | ~419 ns | ALREADY IN WASM                      |
| JS Cost MSE (100 out)      | ~609 ns | ALREADY IN WASM                      |
| Compatibility (cache hit)  | ~70 ns  | NO — below WASM boundary cost        |
| Compatibility (cache miss) | ~277 µs | NO — creature construction dominated |
| Weight modification        | ~21 µs  | NO — trivially fast (clone overhead) |
| UUID computation           | ~21 µs  | NO — string hashing                  |
| Speciation key             | ~50 µs  | NO — negligible phase                |
| WASM activation (small)    | ~724 ns | Already in WASM (baseline)           |
| WASM activation (medium)   | ~3.6 µs | Already in WASM (baseline)           |

## Test Plan

- Added `test/wasm/WasmEvolveDirCoverage.ts` — 9 tests validating WASM coverage
  of evolveDir hot paths:
  - WASM activation availability
  - Forward pass correctness
  - All 6 cost functions produce valid results
  - Breeding produces valid offspring (same and different topologies)
  - Genetic compatibility returns valid scores
  - Self-compatibility is 1.0
  - Mutation preserves creature validity
  - Creature UUID determinism for de-duplication
- Added `bench/EvolveDirWasmMigrationAnalysis.ts` — benchmark evaluating 7
  operations against the WASM decision framework with measured timings
- Updated `docs/PERFORMANCE_RESEARCH.md` with detailed evaluation findings,
  benchmark data, and WASM-resident state feasibility assessment

🤖 Generated with [Claude Code](https://claude.com/claude-code)
