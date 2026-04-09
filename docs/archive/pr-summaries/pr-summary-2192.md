## Summary

Add lifecycle integration tests verifying forward-only validity through
mutation, breeding, serialisation round-trips, and multi-generation evolution.
Closes #2192.

These tests cover the full evolution lifecycle — from creature initialisation
through multiple generations of mutation and breeding — ensuring no creature
ever gains a backward synapse or triggers the "Stripping recurrent synapse"
warning.

## Evidence

All 4 new tests pass on the current codebase, confirming that the forward-only
invariant is maintained throughout:

- Mutation lifecycle: 5 rounds of all forward-only mutations (ADD_NODE,
  SUB_NODE, ADD_CONN, SUB_CONN, MOD_WEIGHT, MOD_BIAS, MOD_SQUASH, SWAP_NODES)
  with validation after each
- Breeding lifecycle: structurally diverse parents bred 20 times, all offspring
  validated
- Serialisation round-trip: exportJSON → fromJSON with logger interception
  confirming zero stripping warnings
- Multi-generation: 6 creatures through 5 generations of mutation + breeding +
  serialisation, all validated

Full quality gate passes (5360 tests, 0 failures).

## Test Plan

- Added `test/lifecycle/ForwardOnlyLifecycle.ts` with 4 integration tests:
  1. **Mutation lifecycle** — initialises a forward-only creature, applies
     multiple rounds of every FFW mutation, validates topology after each
  2. **Breeding lifecycle** — breeds two mutated forward-only parents, validates
     all offspring are forward-only
  3. **Serialisation round-trip** — serialises a mutated creature to JSON and
     back, asserts no stripping warnings and topology/counts preserved
  4. **Multi-generation stress** — runs a small population through 5 generations
     of mutation + breeding + selection, validates every creature at every step
