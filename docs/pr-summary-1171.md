# PR Summary: WASM Performance - Per-call Float32Array allocation overhead

Fixes #1171

## Summary

This PR implements the `activate_into()` method proposed in Issue #1171 to eliminate per-call Float32Array allocation overhead in the WASM `activate()` function. The new method accepts a pre-allocated output buffer that WASM writes into directly, avoiding:

1. **Memory allocation** on every activation call
2. **Per-element boundary crossing** via `set_index()` (now uses bulk `copy_from_slice`)
3. **Garbage collection pressure** from immediately-discarded arrays

### Implementation Details

**Rust WASM (lib.rs):**
- Added `activate_into(&mut self, input: &[f32], output: &mut [f32])` method
- Uses `output.copy_from_slice()` for bulk copy to caller's buffer
- Maintains exact same activation logic as `activate()` for consistency

**TypeScript Wrapper (WasmActivation.ts):**
- Added `activateInto(input: Float32Array, output: Float32Array): void` method
- Added `activateIntoWithFeedback()` for feedback loop control
- Includes input/output buffer length validation

## Evidence

### Benchmark Results

Benchmark run on Apple M4 Pro with 10,000 activations per iteration:

| Network Size | activate() (allocating) | activateInto() (zero-alloc) | Improvement |
|--------------|------------------------|----------------------------|-------------|
| Small (21 neurons, 35 synapses) | 3.5 ms | 3.1 ms | **15% faster** |
| Medium (115 neurons, 767 synapses) | 16.5 ms | 15.8 ms | **4% faster** |
| Large (410 neurons, 7110 synapses) | 91.9 ms | 90.1 ms | **2% faster** |
| Production-Scale (591 neurons) | 54.1 ms | 52.6 ms | **3% faster** |
| Multi-Output (20 outputs) | 39.3 ms | 37.6 ms | **4% faster** |

The improvement is most significant for smaller networks where allocation overhead is a larger proportion of total compute time. For production scoring workloads (millions of records), the cumulative savings are substantial.

### Raw Benchmark Output

```
    CPU | Apple M4 Pro
Runtime | Deno 2.6.4 (aarch64-apple-darwin)

group small-network
| Small: activate() [allocating]              |   3.5 ms |   283.9 iter/s |
| Small: activateInto() [zero-alloc]          |   3.1 ms |   325.8 iter/s |
summary: Small: activate() [allocating] 1.15x slower than activateInto()

group medium-network
| Medium: activate() [allocating]             |  16.5 ms |    60.7 iter/s |
| Medium: activateInto() [zero-alloc]         |  15.8 ms |    63.4 iter/s |
summary: Medium: activate() [allocating] 1.04x slower than activateInto()

group large-network
| Large: activate() [allocating]              |  91.9 ms |    10.9 iter/s |
| Large: activateInto() [zero-alloc]          |  90.1 ms |    11.1 iter/s |
summary: Large: activate() [allocating] 1.02x slower than activateInto()

group production-scale
| Production: activate() [allocating]         |  54.1 ms |    18.5 iter/s |
| Production: activateInto() [zero-alloc]     |  52.6 ms |    19.0 iter/s |
summary: Production: activate() [allocating] 1.03x slower than activateInto()

group multi-output
| Multi-Output: activate() [allocating]       |  39.3 ms |    25.4 iter/s |
| Multi-Output: activateInto() [zero-alloc]   |  37.6 ms |    26.6 iter/s |
summary: Multi-Output: activate() [allocating] 1.04x slower than activateInto()
```

## Test Plan

### New Tests Added
- `test/WasmActivateInto.ts` - 8 comprehensive unit tests:
  - Module initialisation verification
  - Simple ReLU network produces same output as `activate()`
  - Multiple activations reuse the same buffer
  - Works with all standard squash functions (IDENTITY, ReLU, TANH, LOGISTIC, etc.)
  - Works with aggregate functions (MINIMUM, MAXIMUM, IF)
  - Validates input and output buffer lengths
  - Works with larger networks (100 inputs, 50 hidden, 10 outputs)
  - Throws if activation has been freed

### New Benchmarks Added
- `bench/ActivateIntoPerformance.ts` - Comprehensive performance comparison across:
  - Small networks (minimal overhead case)
  - Medium networks (typical use case)
  - Large networks (production-like)
  - Production-scale networks (simulates real workload)
  - Multi-output networks (higher allocation overhead per call)

### Verification
All 1774 existing tests continue to pass after this change.

## Usage Example

```typescript
// Before (allocating on every call)
for (const record of trainingData) {
  const output = wasmActivation.activate(record.input);
  // ... use output ...
} // 2,160,230 Float32Array allocations for production dataset

// After (zero-allocation)
const outputBuffer = new Float32Array(numOutputs); // allocate once
for (const record of trainingData) {
  wasmActivation.activateInto(record.input, outputBuffer);
  // ... use outputBuffer ...
} // 1 allocation total
```

## Related Issues

- Parent issue: #1170 (WASM performance slower than JS)
- This implements Option A (Pre-allocated Output Buffer) from the issue description
