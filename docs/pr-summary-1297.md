# PR Summary: Performance: Pre-allocated result buffers for batch operations

## Summary

This PR implements pre-allocated result buffers for batch operations (activation, training, scoring) to reduce allocation overhead during hot loops. A new `BufferPool` class provides reusable `Float32Array` buffers that can be acquired and released, eliminating repeated allocations.

## Changes

### New Files
- **`src/utils/BufferPool.ts`** - BufferPool class for managing reusable Float32Array buffers
  - O(1) buffer acquisition and release
  - Size-based buffer pooling (exact match)
  - Automatic buffer zeroing on reuse
  - Configurable maximum capacity per size
  - Statistics tracking for monitoring
  - Global shared pool instance for application-wide use

- **`test/BufferPool.ts`** - Comprehensive test suite for BufferPool (15 tests)
  - Buffer acquisition and release behaviour
  - Buffer reuse after release
  - Size-based buffer pooling
  - Pool clearing functionality
  - Statistics tracking
  - Global instance accessibility

- **`bench/BufferPoolPerformance.ts`** - Performance benchmark comparing allocation patterns

### Modified Files
- **`src/architecture/Training.ts`** - Updated training hot loop to use pre-allocated buffers for `observations` and `targets` arrays
- **`src/Creature.ts`** - Updated `traceDir()` method to use pre-allocated buffers in batch processing loop

## Evidence

### Benchmark Results

The BufferPool benchmark shows significant performance improvements over direct Float32Array allocation:

| Pattern | Improvement |
|---------|-------------|
| Small buffers (10 elements) | 6.16x faster |
| Medium buffers (100 elements) | 7.76x faster |
| Large buffers (1000 elements) | 9.76x faster |
| Training pattern (pre-allocated reused) | 867.6x faster |
| Mixed sizes | 8.42x faster |
| Scoped pattern (withBuffer) | 6.35x faster |

Full benchmark output:
```
group small-buffers
| Small (10): new Float32Array() [allocating]         |         10.1 ms |
| Small (10): BufferPool acquire/release [pooled]     |          1.6 ms |

group medium-buffers
| Medium (100): new Float32Array() [allocating]       |         13.8 ms |
| Medium (100): BufferPool acquire/release [pooled]   |          1.8 ms |

group large-buffers
| Large (1000): new Float32Array() [allocating]       |         44.6 ms |
| Large (1000): BufferPool acquire/release [pooled]   |          4.6 ms |

group training-pattern
| Training pattern: new Float32Array() [allocating]   |         22.0 ms |
| Training pattern: Pre-allocated [reused]            |         25.4 µs |
```

The training pattern improvement (867.6x) is particularly relevant because this represents the actual pattern used in `Training.ts` where buffers are pre-allocated once and reused throughout the entire training loop.

## Test Plan

### Unit Tests
- `test/BufferPool.ts` - 15 tests covering:
  - Pool starts empty with zero buffers
  - Acquire returns buffer of correct size
  - Release allows buffer reuse
  - Different sizes tracked separately
  - Acquired buffers are zeroed
  - Clear removes all buffers
  - Creates new buffer when no match available
  - Multiple buffers of same size
  - acquireMany returns correct number of buffers
  - releaseMany releases all buffers
  - Respects maximum capacity
  - withBuffer provides scoped access
  - acquireExact only matches exact size
  - Statistics tracking
  - Global instance accessible

### Integration
- All existing tests pass (1814 tests)
- quality.sh passes cleanly

## References
- Fixes #1297
- Related: #1094 (Float32Array reuse)
- Related: #1171 (Float32Array allocation overhead)
