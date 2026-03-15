## Summary

Final audit pass on all test files in `test/mutate/` for quality standards:
uniqueness, behavioural testing, meaningful assertions, and organisation.
Closes #1769.

### Changes made (this PR)

1. **Removed `test/mutate/AddNeuronSelfLoopFallback.ts`** (1 test):
   - This was a "how" test that used heavy mocking (`stub(Math, "random")`,
     disabled `Neuron.prototype.fix`, and overrode `creature.getSynapse`) to
     force a specific internal code path. Recurrent self-loop behaviour is
     already covered by `AddNeuronRecurrentAllowed.ts` through the public API.

2. **Renamed tests that referenced implementation details**:
   - `AddConnectionOptimisation.ts`: "provides O(1) lookup" → "correctly
     identifies existing and non-existing connections"; "cache invalidates"
     → "reflects newly added connections"
   - `AvailableConnectionsCache.ts`: Removed "cache" from all 6 test names;
     e.g. "cache invalidates after disconnect" → "available connections
     update after disconnect"
   - `ConnectSplice.ts`: "with splice" → "after multiple insertions"
   - `AddConnectionNoRedundantValidation.ts`: "does not call validate
     internally" → "adds a connection and creature remains valid"; "without
     internal validation" → "after successful mutation"
   - `AddNeuronFocusSelection.ts`: "should use transitive focus checking"
     → "downstream neurons are transitively in focus"

3. **Fixed misleading file header comments**:
   - `ConnectSplice.ts`: Changed "Benchmark test" to "Correctness tests"
   - `AddConnectionOptimisation.ts`: Removed O(n²)/O(1) implementation details
   - `AvailableConnectionsCache.ts`: Removed caching implementation details
   - `AddConnectionNoRedundantValidation.ts`: Removed internal validation details

4. **Consolidated near-duplicate tests in `AddConnectionOptimisation.ts`**:
   - Merged "mutation still works correctly with optimisation" (small network)
     and "mutation works correctly with large creature" (large network) into
     one "mutation adds connections and maintains validity" test.

5. **Strengthened weak focus-list assertions**:
   - `AddBackCon.ts`: Focus list test now verifies synapse count increased and
     new connection involves neurons related to the focus list.
   - `AddSelfCon.ts`: Focus list test now asserts mutation succeeds and
     self-connection targets the focused neuron.
   - `AddSelfCon.ts`: Memetic test now asserts mutation succeeds instead of
     silently passing on failure.
   - `SubConnection.ts`: Focus list test now retries and asserts mutation
     succeeds with synapse count verification.

### Changes made (prior PRs)

1. Removed duplicate `test/mutate/MutationStabilityTracker.ts` (13 tests) —
   superseded by `test/NEAT/MutationStabilityTrackerBehavioural.ts`.
2. Consolidated `test/mutate/SwapNodes.ts` into `SwapNeuronsBehavioural.ts`.
3. Renamed `ConnectSpliceBenchmark.ts` to `ConnectSplice.ts`.
4. Cleaned up implementation-detail tests in `AvailableConnectionsCache.ts`.
5. Consolidated `ModActivation.ts` into `ModSquashBehavioural.ts`.
6. Strengthened conditional assertions in `AddBackCon.ts`, `SubBackCon.ts`,
   `SubConnection.ts`.
7. Removed implementation-detail checks in `AddConnectionOptimisation.ts` and
   `AvailableConnectionsCache.ts`.

### Cross-area duplicates noted

- `test/NEAT/MutatorMutateCreature.ts` and `test/NEAT/MutatorBehavioural.ts`
  test individual mutation operators at the integration level. These are NOT
  duplicates — they test the Mutator orchestration layer, not individual
  operators.
- `ModWeightRegularisation.ts` and `ModBiasRegularisation.ts` have similar
  structure but test different operators (ModWeight vs ModBias) with different
  config types. Not duplicates.

## Evidence

- All 4729 tests pass (net -2 from removing 1 test file and consolidating 1 test)
- `./quality.sh` passes clean

## Test Plan

- Verified no test regressions: 4729 passed, 0 failed
- Removed 1 "how" test file (AddNeuronSelfLoopFallback.ts) that used heavy mocking
- Consolidated 1 near-duplicate test in AddConnectionOptimisation.ts
- All remaining tests exercise real mutation code with meaningful assertions
- All test names describe behaviour, not implementation details
