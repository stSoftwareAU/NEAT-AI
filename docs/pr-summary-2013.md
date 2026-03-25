## Summary

Audit and fix compact operations to prevent invalid creatures (synapses
referencing non-existent neurons). Added integrity assertions after every
structural mutation step in `compactCreature()` and 6 new corner-case TDD tests.
No bugs were found — all assertions pass cleanly. Closes #2013.

## Changes

### Integrity assertions in `src/compact/CompactCreature.ts`

Added `assertValidSynapseReferences()` calls (from #2012) after each point where
neurons or synapses are structurally modified:

- After COMPLEMENT bypass neuron removal
- After chain compaction neuron removal
- After backward synapse removal
- Before `Creature.fromJSON()` (final guard)

These assertions run unconditionally, catching any dangling synapse references
immediately at the point of introduction rather than downstream.

### New corner-case tests in `test/compact/CompactCreatureIntegrity.ts`

6 tests covering the scenarios from the issue:

1. **COMPLEMENT bypass with cascading removal** — COMPLEMENT neuron whose
   removal triggers downstream orphan cleanup
2. **Chain compaction where fromNeuron is also a COMPLEMENT candidate** —
   interaction between COMPLEMENT bypass and chain compaction passes
3. **Backward synapse removal creating orphans** — forward-only creature where
   backward removal disconnects hidden neurons
4. **Multiple compact operations in sequence** — COMPLEMENT bypass + chain
   compaction + dead neuron removal all trigger across sequential calls
5. **Neuron with zero-weight synapses that becomes a bridge after pruning** —
   interaction between zero-weight pruning and chain compaction
6. **COMPLEMENT bypass with multiple inbound/outbound connections** — validates
   no dangling references with complex redirect topologies

All tests verify both structural integrity (no dangling synapse references) and
behavioural preservation (output values match pre-compaction).

## Evidence

- All 4992 tests pass (0 failed, 6 ignored)
- `./quality.sh` passes cleanly
- No bugs found — the compact pipeline correctly maintains synapse references
  through all mutation steps

## Test Plan

- 6 new tests in `test/compact/CompactCreatureIntegrity.ts`
- All existing compact tests continue to pass unchanged
