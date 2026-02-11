## Summary

Reduced TypeScript allocation pressure in the backward pass inner loop by
introducing a stack-based pool of reusable buffer sets (`BackpropBuffers`).
Previously, `Neuron.propagate()` allocated 8 fresh arrays per neuron per
training sample. For a network with 800 neurons this created ~6400 short-lived
arrays per sample, putting pressure on the garbage collector.

The new `BackpropBuffers` class manages a pool of buffer sets that are acquired
at the start of each `propagate()` call and released at the end. Since
`propagate()` is recursive (depth-first backward pass), each recursion level
gets its own buffer set from the pool. Buffers grow on demand and are reused
across neurons and training samples. Closes #1379.

## Evidence

Benchmark results (Apple M4 Pro, Deno 2.6.8):

```
group backprop-allocation
| Fresh allocation per neuron (800N)   |  711.5 µs |  1,406 iter/s |
| Reused buffers per neuron (800N)     |  448.1 µs |  2,231 iter/s |

summary
  Fresh allocation per neuron (800N)
     1.59x slower than Reused buffers per neuron (800N)
```

Second run confirms consistency:

```
group backprop-allocation
| Fresh allocation per neuron (800N)   |  689.3 µs |  1,451 iter/s |
| Reused buffers per neuron (800N)     |  448.3 µs |  2,231 iter/s |

summary
  Fresh allocation per neuron (800N)
     1.54x slower than Reused buffers per neuron (800N)
```

**Result: 1.54x-1.59x faster** (37% reduction in per-backward-pass time).

## Changes

- **`src/propagate/BackpropBuffers.ts`** (new): Stack-based pool of reusable
  `BackpropBufferSet` objects containing 4 `number[]` arrays and 4 typed arrays.
- **`src/architecture/CreatureState.ts`**: Added optional `backpropBuffers`
  field, lazily initialised to avoid overhead for evaluation-only creatures.
- **`src/Creature.ts`**: Lazily initialises `backpropBuffers` on first
  `propagate()` call.
- **`src/architecture/Neuron.ts`**: Replaced 8 `new Array`/`new TypedArray`
  allocations with `backpropBuffers.acquire()`/`release()`. Uses `subarray()`
  views for WASM calls since buffers may be larger than `listLength`.
- **`bench/BackpropAllocation.ts`** (new): Benchmark comparing fresh allocation
  vs reused buffers across 800 neurons.

## Test Plan

- Added `test/propagate/BackpropBuffers.ts` (7 tests):
  - Acquire returns buffer with sufficient capacity
  - Released buffer is reused by next acquire
  - Acquire without release gives distinct buffers (stack semantics)
  - Grows capacity when larger buffer needed
  - Zero initial capacity works
  - Stack semantics for recursive use
  - Typed array subarray works for WASM views
- Added `test/propagate/BackpropBufferIntegration.ts` (3 tests):
  - Multi-level training produces correct results with buffer reuse
  - Wider network training exercises variable-length buffer acquisition
  - `backpropBuffers` field initialised on first propagate
- All 2250 existing tests continue to pass
