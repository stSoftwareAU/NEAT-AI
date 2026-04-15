## Summary

Overlap writeScores file I/O with the speciation phase to reduce the idle gap
between parallel phases in the evolution loop. Closes #2315.

**Key findings from benchmarking:**

- The current `ensureDirSync` + `Promise.all` I/O pattern is already the fastest
  approach
- Async `ensureDir` alternatives (two-phase and inline) were **11-17% slower**
  due to promise scheduling overhead
- The real win is **overlapping** the existing async writes with the next
  CPU-bound phase (speciation), not changing the I/O strategy

**Changes:**

1. **Fixed missing `await`**: `writeScores()` was called without `await` in
   `NeatEvolution.ts`, meaning file writes were fire-and-forget, the timing
   measurement was wrong (captured only synchronous setup), and writes could
   still be in-flight during later phases
2. **Overlapped I/O with speciation**: Instead of awaiting writeScores
   sequentially, the promise now runs concurrently with speciation (which is
   CPU-only and reads only in-memory creature data). The `await` happens after
   speciation completes, hiding I/O latency behind useful CPU work
3. **Added benchmark** (`bench/WriteScoresParallel.ts`): Compares three I/O
   strategies at 200 and 500 creature populations

## Evidence

### Benchmark results (Apple M4, Deno 2.7.12)

| Strategy                               | 200 creatures          | 500 creatures          |
| -------------------------------------- | ---------------------- | ---------------------- |
| ensureDirSync + Promise.all (baseline) | 22.0 ms                | 57.1 ms                |
| Two-phase async ensureDir              | 25.7 ms (1.15x slower) | 63.3 ms (1.11x slower) |
| Inline async ensureDir                 | 26.3 ms (1.17x slower) | 64.8 ms (1.13x slower) |

The current I/O pattern is optimal. The improvement comes from overlapping
writes with speciation rather than changing the I/O approach.

### Quality gate

All 5,877 tests pass. `quality.sh` passes cleanly.

## Test Plan

- Added `test/NEAT/WriteScoresParallel.ts` with 3 tests:
  - Verifies correct file output when writeScores is overlapped with concurrent
    CPU work
  - Verifies no file corruption with a 200-creature population
  - Verifies overlapped writes do not interfere with subsequent write operations
- All existing writeScores tests (`WriteScoresDirCache.ts`, `AsyncDiskIO.ts`)
  continue to pass
