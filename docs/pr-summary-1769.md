## Summary

Final audit pass strengthening weak assertions and fixing misleading test names
in `test/mutate/`. Closes #1769.

### Changes

1. **SubNeuron.ts** - Strengthened "cascade removal" test to verify that
   removing one neuron actually triggers cascade cleanup of orphaned neurons
   (previously only checked validity). Strengthened "focus list" test to verify
   that the non-focused neuron is preserved after mutation.

2. **SubBackCon.ts** - Renamed "should remove completely disconnected hidden
   neuron" to "should remove or convert disconnected hidden neuron after
   mutation" and added assertion that the hidden neuron count actually decreases
   (previously only checked mutation succeeded).

3. **SubConnection.ts** - Rewrote "focus list limits removable connections" test
   to properly account for transitive focus behaviour and added a new negative
   test verifying that focus list returns false when no focused connections are
   eligible.

4. **ConnectSplice.ts** - Renamed "correctly inserts at end of synapses array"
   to "correctly inserts and maintains order with higher from-index" (the
   previous name was misleading as the test could not exercise the push-to-end
   case).

### Cross-area duplicates noted

- `test/NEAT/MutatorMutateCreature.ts` and `test/NEAT/MutatorBehavioural.ts`
  test individual mutation operators at the integration level through the
  Mutator API. These are NOT duplicates — they test the orchestration layer, not
  individual operators.

## Evidence

- All 4730 tests pass
- `./quality.sh` passes clean

## Test Plan

- Strengthened assertions in SubNeuron.ts (cascade removal, focus list)
- Strengthened assertion in SubBackCon.ts (disconnected neuron cleanup)
- Rewrote SubConnection.ts focus list test + added negative focus list test
- Fixed misleading test name in ConnectSplice.ts
- All test names now accurately describe the behaviour being verified
