## Summary

Investigate whether additional SIMD optimisations can increase throughput in the
evolution pipeline. Profile 5 candidate numerical operations against the
WASM/SIMD decision framework from PERFORMANCE_RESEARCH.md. Closes #2277.

**Result: Negative.** All 5 candidates fail the SIMD viability criteria. The
existing SIMD coverage (dual-accumulator weighted sum in the activation forward
pass) remains the only operation where SIMD provides meaningful benefit.

## Profiling Results

All benchmarks on Apple M2 Ultra, Deno 2.7.12 (aarch64-apple-darwin).

| Candidate                | Operation              | Time/iter | >10 µs? | SIMD Viable?      |
| ------------------------ | ---------------------- | --------- | ------- | ----------------- |
| 1. Loss error reduction  | MSE — 3 outputs        | 6.1 ns    | NO      | ✗                 |
| 1. Loss error reduction  | MSE — 100 outputs      | 77.1 ns   | NO      | ✗                 |
| 1. Loss error reduction  | CrossEntropy — 100 out | 1.4 µs    | NO      | ✗                 |
| 2. Gradient accumulation | Single weight          | 6.4 ns    | NO      | ✗                 |
| 2. Gradient accumulation | Batch 4-way weight     | 22.6 ns   | NO      | ✗                 |
| 2. Gradient accumulation | Batch 8-way bias       | 1.9 µs    | NO      | ✗                 |
| 3. Score statistics      | WASM activation (20n)  | 935.7 ns  | NO      | Already WASM      |
| 3. Score statistics      | Score cached path      | 106.0 ns  | NO      | Already WASM      |
| 4. Population stats      | Avg 500 creatures      | 468.1 ns  | NO      | ✗                 |
| 4. Population stats      | Sort 500 creatures     | 65.3 µs   | YES     | ✗ (not numerical) |
| 5. Genetic distance      | Set intersection (80n) | 401.0 ns  | NO      | ✗                 |

### Why each candidate fails

1. **Loss error reduction**: Output arrays are 1–10 elements (typical NEAT). Too
   small for SIMD setup cost. Even 100 outputs complete in 77 ns.
2. **Gradient accumulation**: Branchy per-item logic (6+ conditionals), f64 data
   (only 2-wide `f64x2`), and all batches complete in <2 µs.
3. **Score statistics**: Already in WASM (`score_scan.rs`) and cached via
   `CachedScoreComponents`. Nothing to expand.
4. **Population stats**: Sum is trivially fast. Sort exceeds 10 µs but is
   comparison-based, not numerical — incompatible with SIMD.
5. **Genetic distance**: String-based `Set<string>` intersection. Not numerical.
   Cache-dominated with 64% hit rate.

## Evidence

This is a backend/CLI performance investigation with no web interface. Evidence
is provided via benchmark results above and the following test output:

```
running 11 tests from ./test/wasm/SimdExpansionViability.ts
Issue #2277 — Candidate 1: Loss functions produce valid errors ... ok (0ms)
Issue #2277 — Candidate 1: Loss functions handle various output sizes ... ok (0ms)
Issue #2277 — Candidate 2: Weight accumulation updates synapse state ... ok (0ms)
Issue #2277 — Candidate 2: Batch weight accumulation matches single ... ok (0ms)
Issue #2277 — Candidate 2: Bias batch accumulation updates neuron state ... ok (0ms)
Issue #2277 — Candidate 3: Score calculation via WASM path ... ok (2ms)
Issue #2277 — Candidate 4: Population average score is correct ... ok (0ms)
Issue #2277 — Candidate 4: Score sorting preserves all elements ... ok (0ms)
Issue #2277 — Candidate 5: Set intersection count is correct ... ok (0ms)
Issue #2277 — Candidate 5: Empty sets have full compatibility ... ok (0ms)
Issue #2277 — Candidate 5: Disjoint sets have zero compatibility ... ok (0ms)

ok | 11 passed | 0 failed (6ms)
```

Full quality gate: `ok | 5793 passed (2 steps) | 0 failed | 3 ignored`

## Test Plan

- Added `bench/SimdExpansionViability.ts` — profiles all 5 candidate operations
  with `Deno.bench` across multiple data sizes
- Added `test/wasm/SimdExpansionViability.ts` — 11 tests validating correctness
  of each candidate operation:
  - Loss functions: valid errors, various output sizes
  - Weight/bias accumulation: state updates, batch vs single consistency
  - Score calculation: WASM compilation, valid scores
  - Population aggregation: correct averages, sort preservation
  - Set intersection: correct counts, edge cases (empty, disjoint)
- Updated `docs/PERFORMANCE_RESEARCH.md` with complete SIMD expansion
  investigation findings, decision framework analysis, and benchmark data
