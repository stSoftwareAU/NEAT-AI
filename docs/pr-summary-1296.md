# PR Summary: Streaming JSON Parsing for Creature Serialisation

## Summary

Issue #1296 requested streaming JSON parsing for creature serialisation to reduce memory pressure and improve I/O performance for large creatures (600+ neurons, 17k+ synapses).

This PR implements a **streaming creature I/O module** (`src/architecture/StreamingCreatureIO.ts`) that provides:

1. **Incremental JSON writers** - Generator functions that yield JSON chunks for memory-efficient writing
2. **Streaming file readers** - Chunked file reading to avoid loading entire files into memory
3. **Sync and async variants** - Both synchronous and asynchronous APIs for different use cases
4. **Discovery payload support** - Specialised functions for streaming discovery candidate payloads

### Benchmark Results

Benchmarks were run to compare traditional `JSON.stringify()` with the new streaming approach:

```
group small-creature
  Small creature: JSON.stringify + writeTextFileSync [traditional]     55.1 µs
  Small creature: streamCreatureToFileSync [streaming]                116.1 µs
  Summary: traditional 2.10x faster

group medium-creature
  Medium creature: JSON.stringify + writeTextFileSync [traditional]   174.2 µs
  Medium creature: streamCreatureToFileSync [streaming]                 1.3 ms
  Summary: traditional 7.74x faster

group large-creature
  Large creature: JSON.stringify + writeTextFileSync [traditional]      4.8 ms
  Large creature: streamCreatureToFileSync [streaming]                 51.5 ms
  Summary: traditional 10.66x faster
```

### Key Finding

The benchmarks reveal that V8's `JSON.stringify()` is highly optimised and performs better than incremental writing for raw throughput. The streaming approach incurs overhead from multiple small write system calls.

**However, the streaming approach provides value for:**
- Memory-constrained environments where the full JSON string would cause memory pressure
- Very large creatures where avoiding a large intermediate string is beneficial
- Streaming reads that can process data before the entire file is loaded

### Implementation Decision

Based on benchmark results, this PR provides the streaming infrastructure as a library but does **not** replace existing `JSON.stringify()` calls in the codebase. The traditional approach remains faster for typical creature sizes.

The streaming module is available for:
- Future use cases requiring memory-efficient I/O
- Environments with strict memory constraints
- Processing very large creatures (1000+ neurons)

## Evidence

### Benchmark Results

See benchmark output above. Run benchmarks with:
```bash
deno bench --allow-read --allow-write --allow-env --allow-ffi bench/StreamingCreatureIO.ts
```

### Test Coverage

All 10 streaming I/O tests pass, verifying:
- Round-trip serialisation preserves creature structure
- Activation outputs match between original and loaded creatures
- Tags, forwardOnly flag, and memetic data are preserved
- Chunked reading and writing work correctly

## Test Plan

- Added `test/architecture/StreamingCreatureIO.ts` with 10 test cases:
  - Write and read minimal creature
  - Write and read creature with hidden layer
  - Write and read large creature (100+ neurons)
  - Preserve tags
  - Preserve forwardOnly flag
  - Streaming writer produces valid JSON
  - Streaming reader handles chunked input
  - Sync write and read
  - Write produces same output as JSON.stringify
  - Handles creature with memetic data

- Added `bench/StreamingCreatureIO.ts` with performance benchmarks:
  - Small creature comparison
  - Medium creature comparison
  - Large creature comparison
  - Pre-exported creature comparison
  - Batch write comparison

## Files Changed

- **New:** `src/architecture/StreamingCreatureIO.ts` - Streaming I/O module
- **New:** `test/architecture/StreamingCreatureIO.ts` - Unit tests
- **New:** `bench/StreamingCreatureIO.ts` - Performance benchmarks
- **New:** `docs/pr-summary-1296.md` - This PR summary

## References

- Issue #1296: Performance: Streaming JSON parsing for creature serialisation
- Parent: #1288
- Related: #1015 (Avoid JSON clone in compact)
- Related: #1095 (Avoid JSON clone in breed)
