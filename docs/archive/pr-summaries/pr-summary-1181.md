## Summary

Fixes issue #1181: Benchmarks should NOT be unit tests (flaky and very likely to
fail).

Unit tests run in parallel, making timing measurements unreliable. Performance
assertions in unit tests are inherently flaky because:

- Tests compete for CPU resources during parallel execution
- System load varies between runs
- Different machines have different performance characteristics

This PR removes performance assertions from unit tests and moves benchmark code
to the dedicated `bench/` directory where benchmarks can run sequentially and
provide meaningful measurements.

## Changes Made

### Unit Tests Modified (timing assertions removed)

1. **test/score/IncrementalScoreUpdate.ts**
   - Removed performance benchmark test that asserted `improvementRatio > 1.2`
   - A comprehensive benchmark already exists at
     `bench/IncrementalScoreUpdate.ts`

2. **test/propagate/sparse/BuildSynapseMapBenchmark.ts**
   - Removed performance benchmark test that asserted `avgTime < 1000ms`
   - Retained the correctness verification test

3. **test/blackbox/DiscoveryMemoryOptimization.ts**
   - Removed timing assertion `duration < 30000ms`
   - Test now verifies functionality without timing constraints

4. **test/mutate/ConnectSpliceBenchmark.ts**
   - Removed benchmark test that asserted `elapsed < 500ms` for 1000 connect()
     calls
   - Removed memory efficiency benchmark test
   - Retained correctness tests (synapse ordering, insertion at
     beginning/middle/end)

### New Benchmark Files Created

1. **bench/sparse/BuildSynapseMap.ts**
   - Standalone benchmark for `buildSynapseMap` performance (Issue #1029)
   - Usage: `deno run -A bench/sparse/BuildSynapseMap.ts`

2. **bench/mutate/ConnectSplice.ts**
   - Standalone benchmark for `connect()` splice performance (Issue #1093)
   - Tests small, medium, and large creatures
   - Usage: `deno run -A bench/mutate/ConnectSplice.ts`

## Evidence

Unable to generate screenshot: This is a code refactoring change that moves
benchmark logic from unit tests to dedicated benchmark files. No visual
interface is involved.

### Benchmark Results

The new benchmark files can be run to measure performance:

```bash
# BuildSynapseMap benchmark
deno run -A bench/sparse/BuildSynapseMap.ts

# ConnectSplice benchmark
deno run -A bench/mutate/ConnectSplice.ts

# Existing IncrementalScoreUpdate benchmark
deno run -A bench/IncrementalScoreUpdate.ts
```

## Test Plan

- All existing unit tests continue to pass (verified via `./quality.sh`)
- Correctness tests retained to verify functionality
- New benchmark files created for performance measurement when needed
- Tests modified:
  - `test/score/IncrementalScoreUpdate.ts` - 10 tests (removed 1 performance
    test)
  - `test/propagate/sparse/BuildSynapseMapBenchmark.ts` - 1 test (removed 1
    performance test)
  - `test/blackbox/DiscoveryMemoryOptimization.ts` - 3 tests (removed timing
    assertion)
  - `test/mutate/ConnectSpliceBenchmark.ts` - 5 tests (removed 2 performance
    tests)
