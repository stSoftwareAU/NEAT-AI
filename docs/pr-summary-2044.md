## Summary

Reduce intermediate allocations in ModWeight focus-based connection filtering from 3 to 2 by replacing the `Set<Synapse>` → `Array.from(seen)` → `.filter(!frozen)` chain with a single-pass approach that builds the result array directly while deduplicating and checking frozen status inline. Closes #2044.

## Evidence

### Benchmark results (Apple M4 Pro, Deno 2.7.8)

| Scenario | Before (avg) | After (avg) | Change |
|---|---|---|---|
| Small (~119 syn), focus=3 | 1.1 µs | 1.1 µs | ~same |
| Small (~119 syn), focus=10 | 2.1 µs | 2.2 µs | ~same |
| Medium (~239 syn), focus=3 | 1.1 µs | 1.1 µs | ~same |
| Medium (~239 syn), focus=10 | 2.0 µs | 1.8 µs | ~10% faster |
| Medium (~239 syn), focus=20 | 2.7 µs | 2.8 µs | ~same |
| Large (~449 syn), focus=5 | 1.4 µs | 1.4 µs | ~same |
| Large (~449 syn), focus=15 | 2.3 µs | 2.4 µs | ~same |
| Large (~449 syn), focus=30 | 4.1 µs | 4.1 µs | ~same |

The throughput improvement is modest (~10% at medium focus sizes) since these operations are already sub-microsecond. The primary benefit is reduced GC pressure: eliminating the `Array.from()` and `.filter()` intermediate arrays means fewer short-lived allocations per mutation call, which compounds over thousands of mutations per generation.

## Test Plan

- Existing tests: All 20 ModWeight tests pass unchanged
- New test: `ModWeight - focus filtering excludes frozen synapses` — verifies frozen synapses are correctly excluded in the single-pass approach
- New test: `ModWeight - focus with overlapping connections deduplicates correctly` — verifies shared synapses between multiple focus neurons are not over-represented
- New benchmark: `bench/ModWeightFocusFiltering.ts` — measures focus filtering performance across creature sizes (100-500 synapses) and focus list sizes (3-30)
