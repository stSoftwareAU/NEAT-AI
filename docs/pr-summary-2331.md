## Summary

Implement pipelined double-buffered async I/O for `evaluateDir` to overlap disk
reads with WASM scoring. Closes #2331.

**Key changes to `CreatureActivation.evaluateDir`:**

1. **Double-buffered reads**: Two alternating `Uint8Array` buffers (A and B).
   While WASM scores buffer A synchronously, the OS reads the next batch into
   buffer B via async I/O. On the next iteration, roles swap.
2. **Cross-file prefetch**: Pre-opens the next binary file (`Deno.open`) while
   scoring the last batch of the current file, overlapping file-open syscall
   latency with computation.
3. **Extracted `scoreFusedBatch` helper**: Fused WASM batch scoring logic
   extracted into a focused helper function for clarity (Single Responsibility
   Principle).
4. **Deterministic scoring order preserved**: Files are processed in the same
   order, records scored in the same sequence. Only the I/O timing changes.

**Architecture:**

```
Before:  Read batch 1 -> Score batch 1 -> Read batch 2 -> Score batch 2 -> ...
After:   Read batch 1 -> Score batch 1 + Read batch 2 -> Score batch 2 + Read batch 3 -> ...
```

The async `file.read()` submits the read to the OS kernel (via tokio), which
proceeds on a separate I/O thread even while the JS event loop is blocked by
synchronous WASM scoring. When scoring completes and we `await` the read
promise, the I/O is typically already finished.

## Evidence

This is a backend/CLI performance change with no visual output.

**Benchmark results** (Apple M2 Ultra, Deno 2.7.12):

```
group pipelined-scoring
| evaluateDir: 60 small files (10 records each), medium topology |   7.7 ms |   129.1 iter/s |
| evaluateDir: 2 large files (300 records each), medium topology | 564.3 us | 1,772.0 iter/s |
```

**Existing benchmark (no regression):**

```
group small topology
| small topology (2 hidden), 1 worker  |  945.5 us |
| small topology (2 hidden), 2 workers |  905.4 us |

group large topology
| large topology (30 hidden), 1 worker  | 1.3 ms |
| large topology (30 hidden), 2 workers | 1.4 ms |
```

**Test results:** 5907 tests passed, 4 new tests added, 0 regressions.

## Test Plan

- **`test/score/PipelinedBinaryScoring.ts`** (4 new tests):
  - Determinism: `evaluateDir` returns consistent results across repeated calls
    with 20 small files
  - Many files: Correctly handles 50+ binary files exercising pipelined paths
  - Consistency: Single-file vs multi-file evaluation produces identical results
    within float tolerance
  - Per-record path: Non-fused scoring (with output ranges) remains
    deterministic
- **`bench/PipelinedBinaryScoring.ts`**: New benchmark comparing
  many-small-files vs few-large-files evaluation
- All 73 existing `test/score/` tests pass unchanged
- Full test suite (5907 tests) passes with no regressions
