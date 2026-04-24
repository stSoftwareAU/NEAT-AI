## Summary

Adds a mid-flight timeout race around `runParallelAnalysis` and a
defence-in-depth wall-clock cap (`perChunkMaxMs * chunks.length`) in the
discovery analysis loop so a single slow Rust FFI chunk can no longer burn the
entire discovery cycle before the per-chunk budget check fires. Previously the
check only ran **after** the FFI returned — chunk 1/3 observed running 10
minutes against a 2-minute budget caused cascading memory pressure and host OOM
crashes (see GRQ#1821). Closes #2420.

Key changes in
`src/architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts`:

- `AnalysisLoopContext` gains optional `perChunkGraceMs` and
  `runParallelAnalysis` fields. The override makes the parallel driver
  injectable for tests (as required by the issue).
- The fallback `runParallelAnalysis` call is wrapped in `Promise.race` against a
  `perChunkMaxMs + grace` timeout. On timeout, the chunk is abandoned,
  `iterationStalled` is set, and the for-chunks loop breaks. The in-flight
  Promise is intentionally detached (its rejection is swallowed). Note that this
  does not interrupt a synchronous Rust FFI call — the JS event loop is blocked
  while `analyze_parallel` runs with `nonblocking: false` — but it adds a
  structural defence for async drivers and makes the stall recoverable in tests.
- A pre-chunk wall-clock cap (`perChunkMaxMs * chunks.length`) aborts subsequent
  chunks when earlier chunks have already consumed the iteration budget.

## Evidence

Backend-only change, no UI. Verification via tests:

- `deno test test/ErrorGuidedStructuralEvolution/DiscoverAnalysisChunking.ts test/ErrorGuidedStructuralEvolution/DiscoverAnalysisPerChunkTimeout.ts`
  — 10 passed, 0 failed (749 ms).
- `./quality.sh --skip-discovery --skip-wasm` — 6210 passed, 0 failed (1m57s).

## Test Plan

New tests in
`test/ErrorGuidedStructuralEvolution/DiscoverAnalysisPerChunkTimeout.ts`:

- `runAnalysisLoop aborts runParallelAnalysis mid-flight when it never resolves`
  — stubs the parallel driver with a promise that never settles, confirms the
  timeout fires within a few hundred ms, and asserts
  `perfStats.analysisStalled === true`.
- `runAnalysisLoop records no stall when runParallelAnalysis resolves within budget`
  — regression guard: when the driver returns an empty tuple promptly,
  `analysisStalled` stays false.
- `runAnalysisLoop defence-in-depth cap aborts remaining chunks when iteration wall-clock exceeds perChunkMaxMs * chunks`
  — uses a fake clock that advances beyond the cap to verify the loop stops
  submitting further chunks.

Existing `DiscoverAnalysisChunking.ts` tests (Issue #2380) continue to pass — no
behavioural change for chunks that finish within budget or for the existing
per-chunk stall guard.
