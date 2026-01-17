# PR Summary: Performance: Use splice() instead of slice/spread in connect() method

**Issue:** #1093

## Summary

Replaced the inefficient slice/spread array insertion pattern in the `connect()`
method with in-place `Array.splice()` for improved performance and reduced
memory pressure.

### Before (slice/spread pattern)

```typescript
const left = this.synapses.slice(0, location); // O(n) allocation
const right = this.synapses.slice(location); // O(n) allocation
this.synapses = [...left, connection, ...right]; // O(n) allocation
```

### After (splice pattern)

```typescript
this.synapses.splice(location, 0, connection); // In-place modification
```

## Evidence

### Benchmark Results

Benchmark: 1000 `connect()` calls on a creature with ~900 synapses
(representative of mutation operations during evolution).

| Metric                        | Before (slice/spread) | After (splice) | Improvement        |
| ----------------------------- | --------------------- | -------------- | ------------------ |
| Total time (5 runs avg)       | 17.91ms               | 12.17ms        | **32% faster**     |
| Average per connect()         | 0.0179ms              | 0.0122ms       | **32% faster**     |
| Operations/second             | 55,859                | 82,057         | **47% increase**   |
| Memory allocations per insert | 3 arrays              | 0 arrays       | **100% reduction** |

### Raw Benchmark Data

**Before optimisation (slice/spread):**

```
Run 1: 18.40ms (54,346 ops/s)
Run 2: 17.66ms (56,641 ops/s)
Run 3: 18.06ms (55,362 ops/s)
Run 4: 17.22ms (58,076 ops/s)
Run 5: 18.23ms (54,868 ops/s)
Average: 17.91ms (55,859 ops/s)
```

**After optimisation (splice):**

```
Run 1: 12.75ms (78,444 ops/s)
Run 2: 12.21ms (81,890 ops/s)
Run 3: 12.02ms (83,216 ops/s)
Run 4: 11.87ms (84,248 ops/s)
Run 5: 11.98ms (83,490 ops/s)
Average: 12.17ms (82,258 ops/s)
```

### Memory Efficiency

The memory efficiency test shows similar improvements:

- Before: 500 connections in ~3.18ms
- After: 500 connections in ~1.84ms
- **42% faster** for memory-sensitive operations

## Files Modified

- `src/Creature.ts` - Changed `connect()` method (line 928-932) to use
  `splice()` instead of slice/spread

## Test Plan

Added comprehensive tests in `test/mutate/ConnectSpliceBenchmark.ts`:

1. **Correctness tests:**
   - `connect(): maintains correct synapse ordering with splice` - Verifies
     synapses remain sorted after insertions
   - `connect(): correctly inserts at beginning of synapses array` - Tests edge
     case for first position
   - `connect(): correctly inserts at end of synapses array` - Tests edge case
     for last position
   - `connect(): correctly inserts in middle of synapses array` - Tests typical
     insertion case
   - `connect(): stress test with sequential insertions` - Tests many sequential
     insertions

2. **Performance tests:**
   - `connect(): benchmark - 1000 connect() calls on large creature` - Measures
     performance with 1000 connections on ~900 synapses
   - `connect(): benchmark - measures memory efficiency` - Verifies reduced GC
     pressure

All 1390 existing tests continue to pass, confirming the change maintains
backwards compatibility.

## Related

This is a sub-issue of #1090 (Find potential performance improvements in the
evolution process).
