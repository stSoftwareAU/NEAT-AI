## Summary

Await `DiscoveryReplayQueue.waitForCompletion()` in `evolveDir()` before
returning, so that background replay workers finish before the caller can
delete or empty the data directory. Closes #1509.

## Evidence

This is a backend/concurrency fix with no visual output. The fix adds a single
`await` call in `CreatureTraining.ts` after worker termination. The new tests
verify that `waitForCompletion()` blocks until all queued replays (including
chained replays) have finished, and that it is safe to call when no replays
are pending.

## Test Plan

- Added `test/NEAT/DiscoveryReplayQueueCompletion.ts` with three tests:
  - `waitForCompletion resolves after all replays finish` — verifies the
    queue reports no in-progress replay after `waitForCompletion()`
  - `waitForCompletion waits for queued replays too` — verifies both a
    current and queued replay complete before the promise resolves
  - `waitForCompletion is safe when no replays pending` — verifies the
    method resolves immediately when nothing was scheduled
- All 16 existing + new DiscoveryReplayQueue tests pass
