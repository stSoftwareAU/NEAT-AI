## Summary

Fixed a bug in `removeNeuron()` where the non-constant path could leave the creature in a partially corrupted state when bias adjustments overflow.

The existing code (from #1363) added a `Number.isFinite()` guard but applied bias adjustments one synapse at a time. When a neuron had multiple outward connections, if an early adjustment succeeded but a later one overflowed, the function returned `false` while leaving the earlier bias already modified — corrupting the creature's state.

The fix separates validation from application: all bias adjustments are computed and validated first, and only applied if every adjustment is finite. This is consistent with the constant path which already validates before modifying.

## Changes

- **`src/compact/CompactUnused.ts`**: Refactored the non-constant path in `removeNeuron()` to use a two-pass approach — validate all adjustments first, then apply them only if all are finite.
- **`test/Compact/CompactUnusedFiniteGuard.ts`**: Rewrote tests with deterministic topologies using `CreatureExport` instead of `layers`. Added four focused tests:
  1. Normal bias adjustment succeeds
  2. Bias overflow to Infinity is rejected
  3. NaN activation is rejected
  4. Multiple synapses: no partial bias corruption on failure

## Evidence

This is a backend bug fix with no UI changes. Verified by running `./quality.sh` — all 2211 tests pass.

## Test Plan

- `removeNeuron - normal bias adjustment succeeds` — verifies the happy path works correctly
- `removeNeuron - returns false when bias addition overflows to Infinity` — verifies overflow detection
- `removeNeuron - returns false when activation is NaN` — verifies NaN propagation is caught
- `removeNeuron - multiple synapses: no partial bias corruption on failure` — verifies the key bug fix: no partial state mutation when validation fails partway through multiple synapses
