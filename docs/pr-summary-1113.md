## Summary

Fixed process hanging during discovery/replay by implementing proper timeout handling for discovery replay operations (Issue #1113).

### Problem
The evolution process was hanging because:
1. Discovery replay had no timeout - it could run indefinitely
2. When evolution timed out, replay operations would continue, causing the process to hang
3. There was no minimum time threshold check before starting replay

### Solution
Added timeout handling for discovery replay operations:

1. **New Configuration Options** (`NeatArguments.ts`, `NeatConfig.ts`):
   - `discoveryReplayTimeoutMinutes` (default: 5 minutes) - Maximum time for replay operations
   - `discoveryReplayMinTimeMinutes` (default: 1 minute) - Minimum remaining time required before starting replay

2. **DiscoveryReplayQueue Updates** (`DiscoveryReplayQueue.ts`):
   - `scheduleReplay()` now accepts optional `remainingTimeMinutes` parameter
   - Skips replay if remaining time is below the minimum threshold
   - Calculates effective timeout as minimum of remaining time and configured timeout
   - Passes timeout to the replay runner

3. **DiscoveryReplayRunner Updates** (`DiscoveryReplayRunner.ts`):
   - `replayDir()` now accepts optional `timeoutMinutes` parameter
   - Checks timeout before starting evaluations
   - Checks timeout before evaluating combos (after singles)
   - Returns partial results with `timedOut: true` flag when timeout is reached

4. **Evolution Loop Updates** (`Neat.ts`):
   - Passes remaining evolution time to `scheduleReplay()` so replay respects the overall time budget

## Evidence

This is a backend/algorithm fix with no visual interface. The fix prevents process hangs during long-running evolution sessions.

**Test execution output:**
```
running 13 tests from ./test/NEAT/DiscoveryReplayQueue.ts
DiscoveryReplayQueue - schedules replay when new fittest is detected ... ok (3ms)
DiscoveryReplayQueue - only one replay at a time ... ok (108ms)
DiscoveryReplayQueue - returns improved creature ... ok (2ms)
DiscoveryReplayQueue - skips replay if no cache directory ... ok (0ms)
DiscoveryReplayQueue - queues newest fittest when replay in progress ... ok (16ms)
DiscoveryReplayQueue - isReplayInProgress returns correct state ... ok (16ms)
DiscoveryReplayQueue - clearCompletedResults removes results ... ok (3ms)
DiscoveryReplayQueue - skips replay when remaining time is below minimum threshold ... ok (0ms)
DiscoveryReplayQueue - passes timeout to replay function ... ok (1ms)
DiscoveryReplayQueue - caps timeout to configured maximum ... ok (1ms)
DiscoveryReplayQueue - uses default timeout when no remaining time provided ... ok (3ms)
DiscoveryReplayQueue - custom minimum time threshold ... ok (0ms)
DiscoveryReplayQueue - allows replay when remaining time equals minimum threshold ... ok (2ms)
ok | 13 passed | 0 failed (388ms)

running 4 tests from ./test/discovery/DiscoveryReplayRunner.ts
DiscoveryReplayRunner prunes stale successes and prefers best combo ... ok (3ms)
DiscoveryReplayRunner returns timedOut when timeout occurs before evaluation ... ok (0ms)
DiscoveryReplayRunner completes normally with sufficient timeout ... ok (0ms)
DiscoveryReplayRunner works without timeout (undefined) ... ok (0ms)
ok | 4 passed | 0 failed (6ms)
```

## Test Plan

Added new tests to verify timeout behaviour:

### DiscoveryReplayQueue Tests (`test/NEAT/DiscoveryReplayQueue.ts`):
- **skips replay when remaining time is below minimum threshold**: Verifies replay is skipped when remaining time (0.5 min) is below the default minimum (1 min)
- **passes timeout to replay function**: Verifies timeout is correctly passed (min of remaining time and configured timeout)
- **caps timeout to configured maximum**: Verifies timeout is capped when remaining time exceeds configured maximum
- **uses default timeout when no remaining time provided**: Verifies configured timeout is used when no remaining time is passed
- **custom minimum time threshold**: Verifies custom `discoveryReplayMinTimeMinutes` setting is respected
- **allows replay when remaining time equals minimum threshold**: Verifies replay runs when remaining time exactly equals the threshold

### DiscoveryReplayRunner Tests (`test/discovery/DiscoveryReplayRunner.ts`):
- **returns timedOut when timeout occurs before evaluation**: Tests early timeout path
- **completes normally with sufficient timeout**: Verifies normal operation with adequate time
- **works without timeout (undefined)**: Verifies backward compatibility when no timeout is specified

## Breaking Changes

None. The new configuration options have sensible defaults that preserve existing behaviour:
- `discoveryReplayTimeoutMinutes: 5` - Provides a reasonable default timeout
- `discoveryReplayMinTimeMinutes: 1` - Only skips replay when very little time remains

Existing code that doesn't pass `remainingTimeMinutes` to `scheduleReplay()` will use the configured default timeout.
