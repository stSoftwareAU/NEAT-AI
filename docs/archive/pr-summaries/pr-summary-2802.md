## Summary

Removed a HOW-assertion (anti-pattern #1) from
`test/creature/EpisodeAdapter_test.ts`. The test "EpisodeAdapter:
assertContract() is idempotent on repeat calls" previously subclassed
`DefaultGuardAdapter` purely to count internal `reset()` invocations and
asserted `resetCalls === 1`. That pinned an implementation detail (the one-shot
caching of the contract probe) rather than any observable behaviour, so a valid
refactor of `assertContract()` — lazy reset, reset-on-every-call, or validation
without reset — would break the test even though the behaviour was unchanged.

The test now asserts the observable contract directly (issue option (a)):
calling `assertContract()` repeatedly on a well-formed adapter is safe and
returns a stable result (`undefined`) without throwing. No reference to the
internal `reset()` method remains.

Closes #2802.

## Evidence

Backend/test-only change — no UI to screenshot.

Targeted run of the affected file (all 10 tests pass, including the rewritten
idempotency test):

```
running 10 tests from ./test/creature/EpisodeAdapter_test.ts
...
EpisodeAdapter: assertContract() is idempotent on repeat calls ... ok (0ms)
ok | 10 passed | 0 failed (6ms)
```

### Pre-existing unrelated failure

`./quality.sh` reports one failure in
`test/creature/evolveRL_heapStability_test.ts` ("heap stays bounded across many
generations", Issue #2693). This is a GC/heap-measurement test wholly unrelated
to this change — it fails identically on the clean `Develop` tree with my change
stashed, confirming it is pre-existing and not caused by this PR.

## Test Plan

- Modified
  `test/creature/EpisodeAdapter_test.ts::EpisodeAdapter: assertContract() is idempotent on repeat calls`
  to assert observable behaviour (no throw, stable `undefined` return on repeat
  calls) instead of counting internal `reset()` calls.
- Ran `deno test test/creature/EpisodeAdapter_test.ts` — 10 passed, 0 failed.
