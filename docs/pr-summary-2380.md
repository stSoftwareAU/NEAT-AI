# Discovery Rust combined analysis — chunking + adaptive stall guard

Closes #2380

## Root cause

`runAnalysisLoop` in
`src/architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts`
submitted the entire focus list (up to `discoveryMaxNeurons`, default 6) to
`DiscoverStructure.ensureRustCombinedAnalysis(...)` as a single FFI call. That
call is synchronous — once Rust starts the combined analysis TS cannot
preempt it. When one of the neurons stalls (CPU fallback, pathological
topology, etc.), the whole 10-minute analysis budget is consumed by one
uninterruptible Rust call, producing exactly the pattern in
`GRQ-22-sloth.log`:

```
Rust combined analysis: 9m 56s 236ms
Neurons analyzed: 6
Neurons/sec: 0
```

The TS layer had no checkpoint between the call starting and the 10-minute
deadline firing.

## Fix

Break the single Rust FFI call into **chunks**. Each chunk runs the full
pipeline (combined analysis → candidate collection → squash analysis), and
between chunks the loop checks:

1. **Per-chunk budget** — if a single chunk exceeded
   `discoveryAnalysisPerChunkMaxMs` (default 120 000 ms), set
   `analysisStalled=true` and break out of the retry loop. This is the
   adaptive early-exit required by the acceptance criteria.
2. **Deadline** — the existing `getTimeoutTS()` check now runs after every
   chunk, not just after the whole focus list.

With defaults (`chunkSize=2`, `perChunkMaxMs=120 000`), 6 focus neurons
become three FFI calls; a single 2-minute stall aborts the remainder of the
cycle instead of burning the full 10 minutes on one call.

## Changes

- **New config fields** (defaults preserve "at most a 6-minute budget burn
  before bailing out"):
  - `discoveryAnalysisChunkSize` — default `2`; `0` submits the whole focus
    list in one call (the pre-#2380 behaviour).
  - `discoveryAnalysisPerChunkMaxMs` — default `120000`; `0` disables the
    stall guard.
- **`DataRecorderAnalysis.ts`**
  - New exported helper `chunkFocusList(focusList, chunkSize)` — small, pure,
    easy to unit-test.
  - Inner analysis body restructured into a per-chunk `for` loop.
  - After each chunk: per-chunk elapsed time + GPU usage logged
    (`[synapse=gpu neuron=cpu]`), deadline and stall-guard both checked.
  - Optional `now` injection on `AnalysisLoopContext` so tests can drive
    deterministic elapsed-time scenarios.
- **`DiscoveryPerformanceStats`** — added `analysisStalled` boolean so the
  caller can observe when the stall guard fired.
- **`DataRecorder.ts`** — passes the two new config values through to
  `runAnalysisLoop`.

## Tests

New `test/ErrorGuidedStructuralEvolution/DiscoverAnalysisChunking.ts`:

- `chunkFocusList` — splits fixed-size sublists, treats `<=0` as disabled,
  returns `[]` for empty input.
- `runAnalysisLoop submits the focus list in chunks of analysisChunkSize` —
  every captured FFI call carries at most `analysisChunkSize` neurons.
- `runAnalysisLoop submits whole focus list in one call when chunking
  disabled` — backwards-compat path still works when chunking is off.
- `runAnalysisLoop aborts retries when a single chunk exceeds perChunkMaxMs
  (stall guard)` — uses an injected clock that advances 5 000 ms per call,
  asserts the loop bails after at most 2 FFI calls and sets
  `analysisStalled=true`. **Fails against the pre-#2380 code.**
- `runAnalysisLoop does not mark analysisStalled when all chunks finish
  within budget` — sanity check: no false positives with a generous budget.

## Test plan

- [x] `deno test --allow-all test/ErrorGuidedStructuralEvolution/DiscoverAnalysisChunking.ts` → 7 passed, 0 failed.
- [x] `./quality.sh --skip-wasm` (full test suite, WASM skipped because the
      local `build.sh` sync pulled a truncated WASM pkg on this workstation)
      → 6002 passed, 0 failed.
- [ ] CI re-runs the full `./quality.sh` (including WASM sync) on a clean
      runner.
