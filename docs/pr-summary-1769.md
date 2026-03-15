## Summary

Audit all test files in `test/mutate/` for quality standards: uniqueness,
behavioural testing, meaningful assertions, and organisation. Closes #1769.

### Changes made (this PR)

6. **Strengthened conditional assertions in `test/mutate/AddBackCon.ts`**:
   - Tests "should add a back connection" and "should delete memetic property"
     had `if (changed)` guards that silently passed when mutation failed.
   - Rewrote both to retry in a loop and assert that mutation succeeds at least
     once, ensuring the assertion is always exercised.

7. **Removed implementation-detail checks in
   `test/mutate/AddConnectionOptimisation.ts`**:
   - Tests were asserting internal numeric key formula
     (`from * neuronCount + to`) for the connection set, coupling tests to
     internal representation.
   - Replaced with `hasConnection()` public API assertions that verify the same
     behaviour without depending on the internal key format.

8. **Removed implementation-detail checks in
   `test/mutate/AvailableConnectionsCache.ts`**:
   - Same numeric key formula pattern replaced with `hasConnection()` calls.

9. **Fixed meaningless tests in `test/mutate/SubBackCon.ts`**:
   - "should convert neuron to constant" exited silently if the edge-case
     scenario was never hit. Rewrote as "mutation always produces valid creature
     even when neuron loses inward connections" with real assertions.
   - "should handle focus list correctly" had no meaningful assertion. Rewrote
     as "focus list restricts which connections can be removed" with assertion
     that the back connection is preserved when excluded by focus.
   - "should handle various network structures" had conditional assertion.
     Rewrote with retry loop to ensure mutation actually succeeds.
   - "should delete memetic property" had same conditional pattern — fixed.

10. **Fixed meaningless tests in `test/mutate/SubConnection.ts`**:
    - "should handle creature with minimal connections" had no assertion about
      the mutation result. Rewrote as "creature remains valid after removing
      from minimal network" with synapse count assertion.
    - "should handle orphan cleanup after removal" ran 50 mutations with no
      assertion about orphan cleanup. Rewrote to verify hidden neuron count
      decreases after connection removal.

### Changes made (prior PRs)

1. Removed duplicate `test/mutate/MutationStabilityTracker.ts` (13 tests) —
   superseded by `test/NEAT/MutationStabilityTrackerBehavioural.ts`.
2. Consolidated `test/mutate/SwapNodes.ts` into `SwapNeuronsBehavioural.ts`.
3. Renamed `ConnectSpliceBenchmark.ts` to `ConnectSplice.ts`.
4. Cleaned up implementation-detail tests in `AvailableConnectionsCache.ts`.
5. Consolidated `ModActivation.ts` into `ModSquashBehavioural.ts`.

### Cross-area duplicates noted

- `test/NEAT/MutatorMutateCreature.ts` and `test/NEAT/MutatorBehavioural.ts`
  test individual mutation operators at the integration level. These are NOT
  duplicates — they test the Mutator orchestration layer, not individual
  operators.
- `ModWeightRegularisation.ts` and `ModBiasRegularisation.ts` have similar
  structure but test different operators (ModWeight vs ModBias) with different
  config types. Not duplicates.

## Evidence

- All 4731 tests pass
- `./quality.sh` passes clean

## Test Plan

- Verified no test regressions: 4731 passed, 0 failed
- All rewritten tests exercise real mutation code with meaningful assertions
- No tests removed — only rewritten to be more robust
