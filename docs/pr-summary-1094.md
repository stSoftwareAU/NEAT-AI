## Summary

Implemented buffer reuse optimisation for `activate()` and `activateAndTrace()` methods in `src/Creature.ts` to reduce GC pressure during evolution. The optimisation adds a new optional `reuseBuffer` parameter that allows callers to reuse a cached `Float32Array` instead of creating a new one on each call.

### Changes Made

1. **Added `cachedOutputBuffer` property** to the `Creature` class to store a reusable output buffer
2. **Updated `activate()` method** to accept a new `reuseBuffer` parameter (default: `false`)
3. **Updated `activateAndTrace()` method** to accept a new `reuseBuffer` parameter (default: `false`)
4. **Added `extractOutputs()` private method** to handle the buffer reuse logic in a single place
5. **Updated `clearState()` method** to clear the cached output buffer when state is reset

### API Changes

The following methods now accept an optional `reuseBuffer` parameter:

```typescript
// Before
activate(input: Float32Array, feedbackLoop?: boolean): Float32Array
activateAndTrace(input: Float32Array, feedbackLoop: boolean, sparseConfig: SparseConfig): Float32Array

// After
activate(input: Float32Array, feedbackLoop?: boolean, reuseBuffer?: boolean): Float32Array
activateAndTrace(input: Float32Array, feedbackLoop: boolean, sparseConfig: SparseConfig, reuseBuffer?: boolean): Float32Array
```

**Backward Compatibility**: The default behaviour (`reuseBuffer=false`) creates a new `Float32Array` on each call, maintaining full backward compatibility. The new parameter is opt-in only.

## Evidence

### Benchmark Results

The benchmark tests demonstrate significant performance improvements:

| Test Scenario | Baseline | With Buffer Reuse | Improvement |
|---------------|----------|-------------------|-------------|
| 10,000 activations (100 outputs) | 9.92ms | 6.83ms | **31.1%** |
| Large creature (500+ neurons) | 90.15ms | 89.66ms | 0.5% |
| Output scaling (200 outputs) | 0.98μs/call | 0.45μs/call | **53.7%** |
| Memory stress test (50,000 iter) | 43.90ms | 36.31ms | **17.3%** |
| Fitness evaluation simulation | 7.32ms | 4.26ms | **41.7%** |

**Key Findings**:
- **31-54% improvement** for repeated activations depending on output count
- **Greater benefit with more outputs** - scaling test shows improvement increases from 31.7% (10 outputs) to 53.7% (200 outputs)
- **Fitness evaluation shows 41.7% improvement** - significant for evolution loops with population sizes of 100+
- **Large creatures show minimal improvement** because activation time is dominated by neuron computation, not array allocation

The benchmark exceeds the expected 5-15% improvement mentioned in the issue, achieving 31-54% improvement for the primary use case (repeated activations with many outputs).

## Test Plan

### New Test Files

1. **`test/ActivateBufferReuse.ts`** - 10 tests covering:
   - Default behaviour returns new arrays (backward compatibility)
   - Buffer reuse with `reuseBuffer=true` returns same array reference
   - `activateAndTrace()` supports buffer reuse
   - Cached buffer resizes when output count changes
   - Reused buffer values update correctly on each activation
   - `clearState()` clears cached output buffer
   - Complex network produces correct output with buffer reuse
   - Caller can safely modify array when `reuseBuffer=false`
   - Buffer reuse works correctly with 100+ outputs

2. **`test/ActivateBufferReuseBenchmark.ts`** - 5 benchmark tests covering:
   - 10,000 activations with 100 outputs (required by issue)
   - Large creature (500+ neurons) performance
   - Output count scaling comparison
   - Memory allocation stress test
   - Fitness evaluation simulation

### Running the Tests

```bash
# Run correctness tests
deno test test/ActivateBufferReuse.ts

# Run benchmark tests
deno test test/ActivateBufferReuseBenchmark.ts
```

Closes #1094
