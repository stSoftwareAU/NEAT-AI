# PR Summary: Add Test Coverage for Discovery Replay Integration (#1164)

## Summary

This PR adds comprehensive test coverage for the previously untested discovery replay integration code in `Neat.evolve()`. The code was identified as missing test coverage from issue #997, which introduced the `DiscoveryReplayQueue` for non-blocking background replay of cached discoveries.

The untested code path (Neat.ts lines 1110-1151) processes completed replay results and adds improved creatures to the population. This includes:
- Getting completed results from `discoveryReplayQueue.getCompletedResults()`
- Calling `logReplaySummary(result)` for each result
- Creating a `Creature` from the JSON when `result.improvement?.creature` exists
- Generating a UUID via `CreatureUtil.makeUUID()`
- Tagging the creature with "discovery-replay" approach
- Validating the creature via `validateAfterDiscoveryOrThrow()`
- Adding the creature to `trainedPopulation`
- Logging verbose output when enabled
- Clearing results after processing

## Evidence

This is a testing-only change (bug fix via test coverage). The tests verify the previously untested code paths work correctly.

### Test Results
All 14 new tests pass:
```
ok | 14 passed | 0 failed (41ms)
```

Full quality check passes:
```
ok | 1765 passed (2 steps) | 0 failed | 1 ignored (4m10s)
```

## Test Plan

Added `test/NEAT/DiscoveryReplayIntegration.ts` with 14 test cases:

1. **creates creature from improvement result** - Verifies creature creation from JSON
2. **tags creature with discovery-replay approach** - Verifies the approach tag is applied
3. **validates replayed creature** - Verifies `validateAfterDiscoveryOrThrow()` is called
4. **adds replayed creature to population array** - Verifies creature is added to trainedPopulation
5. **logs verbose output when creature is added** - Verifies verbose logging works
6. **skips when improvement has null creature** - Edge case: null creature handling
7. **skips when no improvement** - Edge case: no improvement handling
8. **processes multiple replay results** - Verifies sequential processing of multiple results
9. **calls logReplaySummary for each result** - Verifies integration with logging
10. **skips verbose logging when verbose is false** - Verifies verbose flag is respected
11. **uses replay as fallback key** - Verifies `result.improvement.key ?? "replay"` fallback
12. **handles undefined scoreDelta** - Verifies `scoreDelta?.toFixed(4) ?? "N/A"` fallback
13. **handles undefined uuid in logging** - Verifies `uuid?.substring(0, 8) ?? "unknown"` fallback
14. **results are cleared after processing** - Verifies `clearCompletedResults()` behaviour

### Referenced Issue
Closes #1164
