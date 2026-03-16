## Summary

Reduced de-duplication frequency in the evolution loop from two passes to a
single pass, improving performance by eliminating redundant operations.

### What Changed

The `evolve()` method in `src/NEAT/Neat.ts` previously performed de-duplication
twice per generation:

1. **After breeding/mutation**: De-duplicated `newPopulation` immediately after
   breeding and mutation
2. **After combining sources**: De-duplicated the combined population from all
   sources (elitists, trained, fine-tuned, new, DNA)

Now, de-duplication is performed only once after all population sources are
combined. This eliminates:

- Redundant UUID computation for creatures in `newPopulation`
- Duplicate experiment store checks (file system I/O)
- Unnecessary replacement breeding/mutation operations

### Implementation

The change was simple - removed the `deDuplicator.perform(newPopulation)` call
and kept only the final de-duplication pass. The `DeDuplicator` is still
instantiated at the same point (to keep the `breed` and `mutator` references in
scope), but its `perform()` method is only called once at the end.

## Evidence

### Benchmark Results

Run with:
`deno bench --allow-read --allow-write --allow-env --allow-ffi bench/SinglePassDeDuplication.ts`

```
| benchmark                                         | time/iter (avg) |  iter/s |
| ------------------------------------------------- | --------------- | ------- |
| Two-pass de-duplication (old)                     |          6.7 ms |   149.3 |
| Single-pass de-duplication (new)                  |          6.2 ms |   161.0 |

summary
  Single-pass de-duplication (new)
     1.08x faster than Two-pass de-duplication (old)

| Single-pass with 50% duplicates (150 creatures)   |          7.2 ms |   139.2 |
| Two-pass with 50% duplicates (150 creatures)      |         11.1 ms |    89.7 |

summary
  Single-pass with 50% duplicates
     1.55x faster than Two-pass with 50% duplicates
```

**Key findings:**

- **General case**: 1.08x faster (8% improvement)
- **High duplicate scenarios (50%)**: 1.55x faster (55% improvement)

The improvement is more significant when there are many duplicates because the
single-pass approach avoids processing the same duplicates twice.

## Test Plan

### New Tests Added

Added `test/SinglePassDeDuplication.ts` with three test cases:

1. **`SinglePassDeDuplication - produces same uniqueness as two-pass`**:
   Verifies that single-pass de-duplication produces a population with no
   duplicates, same as the two-pass approach
2. **`SinglePassDeDuplication - catches cross-source duplicates`**: Verifies
   that duplicates between different population sources (elitists, trained, new,
   DNA) are correctly detected and handled
3. **`SinglePassDeDuplication - evolution completes successfully`**: Integration
   test that runs the full evolution loop with the new approach

### Existing Tests

All 1439 existing tests continue to pass, including:

- `test/DeDuplicate.ts` - Core de-duplication functionality
- `test/EarlyDeDuplication.ts` - Issue #1014 tests for de-duplication behaviour

### Benchmark Added

Added `bench/SinglePassDeDuplication.ts` with benchmarks comparing:

- Two-pass vs single-pass de-duplication
- UUID computation overhead
- High duplicate scenarios (50% duplicate rate)

## Files Modified

- `src/NEAT/Neat.ts` - Removed early `deDuplicator.perform()` call, updated
  comments
- `test/SinglePassDeDuplication.ts` - New test file (3 tests)
- `bench/SinglePassDeDuplication.ts` - New benchmark file

## Related Issues

- Implements #1099: Performance: Reduce de-duplication frequency in evolution
  loop
- Supersedes approach from #1014: Performance: De-duplicate population before
  training/discovery
- Part of #1090: Find potential performance improvements in the evolution
  process
