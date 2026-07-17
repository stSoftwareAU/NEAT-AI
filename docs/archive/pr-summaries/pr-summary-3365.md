## Summary

Removed the machine-dependent wall-clock timing assertion from the first test in
`test/ErrorGuidedStructuralEvolution/DiscoverAnalysisPerChunkTimeout.ts`. Closes
#3365.

The test _"runAnalysisLoop aborts runParallelAnalysis mid-flight when it never
resolves"_ measured `Date.now()` around the run and asserted `elapsed < 60_000`.
That is a HOW-test of the runner's real-time performance, not a WHAT-test of
observable behaviour, and it violates the project testing policy (no timing APIs
in `test/`). The genuine contract — that a never-resolving `runParallelAnalysis`
is aborted mid-flight — is already fully asserted by
`assert(perfStats.analysisStalled, …)`. The wall-clock check only tied the test
to the host machine's scheduling (CI load, ARM vs x86), risking flakes without
guarding any real regression. This mirrors the fix already applied to the
sibling file `DiscoveryTimeout.ts` in #2998 / PR #3011.

Applied resolution (a) from the issue: deleted the `elapsed < 60_000` assertion
and the now-unused `started` / `elapsed` `Date.now()` measurements, leaving a
strictly behavioural test.

## Evidence

Backend/test-only change — no web interface to screenshot.

The affected test file passes after the change:

```
runAnalysisLoop aborts runParallelAnalysis mid-flight when it never resolves ... ok
runAnalysisLoop records no stall when runParallelAnalysis resolves within budget ... ok
runAnalysisLoop defence-in-depth cap aborts remaining chunks when iteration wall-clock exceeds perChunkMaxMs * chunks ... ok

ok | 3 passed | 0 failed
```

`./quality.sh --lint-only` (format, lint, bash syntax) and `deno check` on the
modified file both pass cleanly.

The remaining assertions — `perfStats.analysisStalled` (the observable stall
outcome) and `callCount >= 1` (the driver was invoked) — continue to verify the
timeout's behaviour with no reliance on real elapsed time.

## Test Plan

- Modified
  `test/ErrorGuidedStructuralEvolution/DiscoverAnalysisPerChunkTimeout.ts`:
  removed the `elapsed < 60_000` wall-clock assertion and its
  `started`/`elapsed` `Date.now()` measurements from the first test.
- Ran the full file: all 3 tests pass, including the two deterministic tests
  that already model the correct fake-clock technique.
- No production code changed; no tests removed or commented out.
