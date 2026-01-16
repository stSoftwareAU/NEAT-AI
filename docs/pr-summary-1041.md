# PR Summary: Performance: Use TypedArray for dense neuron state storage

## Summary

This PR implements issue #1041 by replacing the `Map<number, number>` storage
for `cacheAdjustedActivation` in `CreatureState` with a TypedArray-backed
`DenseNumberMap` class. This optimisation provides better cache locality and
reduced memory overhead for dense neuron indices.

### Changes

1. **New `DenseNumberMap` class** (`src/architecture/DenseNumberMap.ts`):
   - Uses `Float64Array` for value storage (full precision)
   - Uses `Uint8Array` for presence tracking (efficient has/clear operations)
   - Provides Map-like interface (`set`, `get`, `has`, `clear`)
   - Automatically resizes when indices exceed capacity
   - Initial capacity based on creature's neuron count

2. **Updated `CreatureState`** (`src/architecture/CreatureState.ts`):
   - Replaced `Map<number, number>` with `DenseNumberMap` for
     `cacheAdjustedActivation`
   - Pre-allocates based on creature's neuron count for optimal performance
   - Maintains backward compatibility with existing Map-like usage patterns

## Evidence: Benchmark Results

Benchmark comparing `DenseNumberMap` vs `Map<number, number>`:

| Neurons | Operation | Map (ms) | DenseNumberMap (ms) | Speedup |
| ------- | --------- | -------- | ------------------- | ------- |
| 100     | set       | 43.56    | 7.44                | 5.86x   |
|         | get       | 4.12     | 3.58                | 1.15x   |
|         | has       | 3.62     | 2.33                | 1.56x   |
|         | clear     | 42.47    | 6.57                | 6.46x   |
| 1000    | set       | 136.94   | 50.14               | 2.73x   |
|         | get       | 47.16    | 21.07               | 2.24x   |
|         | has       | 30.94    | 11.61               | 2.67x   |
|         | clear     | 247.47   | 48.74               | 5.08x   |
| 10000   | set       | 4375.93  | 505.58              | 8.66x   |
|         | get       | 631.31   | 214.94              | 2.94x   |
|         | has       | 289.26   | 97.44               | 2.97x   |
|         | clear     | 4350.87  | 669.38              | 6.50x   |

**Key findings:**

- **Set operations**: 2.7x to 8.7x faster (most significant for propagation
  cache updates)
- **Get operations**: 1.15x to 2.94x faster (important for cache lookups during
  backpropagation)
- **Has operations**: 1.56x to 2.97x faster
- **Clear operations**: 5.08x to 6.50x faster (called at start of each
  propagation)

The performance improvements scale with neuron count, providing greater benefits
for larger creatures.

## Test Plan

### New Tests Added (`test/CreatureStateOptimised.ts`)

- `DenseNumberMap basic operations` - Tests set/get/has for basic functionality
- `DenseNumberMap clear operation` - Tests clearing all values
- `DenseNumberMap overwrite values` - Tests updating existing values
- `DenseNumberMap handles zero values correctly` - Tests that zero is treated as
  a valid value
- `DenseNumberMap resize when needed` - Tests automatic capacity growth
- `CreatureState cacheAdjustedActivation uses DenseNumberMap` - Tests Map-like
  interface in CreatureState
- `CreatureState node() returns consistent NeuronState for same index` -
  Regression test
- `CreatureState clear() resets node and connection state` - Tests clear
  behaviour
- `DenseNumberMap clear() clears adjusted activation cache` - Tests cache
  clearing
- `CreatureState preserves behaviour with large neuron count` - Tests with 65
  neurons
- `CreatureState activation array uses Float32Array` - Verifies existing
  Float32Array usage
- `DenseNumberMap is used internally by CreatureState` - Confirms implementation

### Benchmark Added (`bench/DenseNumberMapBenchmark.ts`)

- Comprehensive benchmark comparing Map vs DenseNumberMap performance
- Tests set, get, has, and clear operations
- Tests with 100, 1000, and 10000 neurons

### Existing Tests

All 1341 existing tests pass, confirming no regressions.

## Related Issue

Fixes #1041 - Performance: Use TypedArray for dense neuron state storage

Part of #1008 - Performance improvements in evolution process
