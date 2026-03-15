## Summary

Fifth-pass audit of compact, optimisation, feed-forward, and optimise test files
across `test/Compact/`, `test/optimize/`, `test/FeedForward/`, and
`test/reconstruct/`. Strengthens weak assertions, removes debug file I/O from
tests, fixes misleading test names, and improves test robustness with explicit
existence guards. Closes #1772.

## Changes

### Weak assertions replaced with exact values or proper assertion methods (5 files)

**test/Compact/CompactCreature.ts** -- Replaced four `if (result)` conditional
blocks with `assert(result !== undefined)` so tests fail loudly when compaction
unexpectedly returns undefined. Rewrote the IDENTITY chain test to use a valid
two-hidden-neuron topology that actually triggers chain compaction (same-squash
requirement).

**test/Compact/CompactUnusedFiniteGuard.ts** -- Replaced
`assertEquals(Number.isFinite(bias), true)` with `assertAlmostEquals(bias, 0.65)`
matching the exact formula `0.5 + (0.3 * 0.5)`.

**test/Compact/CompactCreatureSimplifyLargeWeights.ts** -- Replaced `assert(beforeMax >= 1e6)` with `assertEquals(beforeMax, 1e6)` for exact value check.

**test/Compact/ZeroWeightSynapsePruning.ts** -- Replaced
`assertEquals(typeof compacted !== "undefined", true)` with
`assert(compacted !== undefined)` and removed non-null assertion operators.

**test/optimize/FunctionCache.ts** -- Replaced `assert(cache.key.length > 0)`
with `assertNotEquals(cache.key, "")` and `assert(x !== y)` comparisons with
`assertNotEquals(x, y)` for clearer failure messages. Removed unused `assert`
import.

### Debug file I/O removed (1 file)

**test/Compact/CompactCreatureComplementBypass.ts** -- Removed
`Deno.mkdirSync()` and `Deno.writeTextFileSync()` calls that wrote debug JSON
artifacts to `.test/` directories. These are implementation-detail side effects
that do not belong in unit tests.

### Misleading test names fixed (2 files)

**test/FeedForward/ForwardOnlySemanticVersion.ts** -- Fixed two test names that
said "2.x.x -> 3.0.0" but asserted "4.0.0".

**test/FeedForward/AddNeuronForwardOnly.ts** -- Replaced
`assertEquals(x > y, true)` with `assert(x > y, message)` for clearer failure
output.

### Test names and assertions improved (2 files)

**test/optimize/makeSynapsesValue.ts** -- Added explicit `assert(synapse)` guards
before non-null assertion operators. Improved test names to describe the specific
output format being verified.

**test/FeedForward/ForwardOnlyFlag.ts** -- Replaced
`assert(exported.forwardOnly === true)` with `assertEquals(exported.forwardOnly, true)`.

## Evidence

All 4520 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified all strengthened assertions match the implementation formulas
- Verified IDENTITY chain test uses valid topology that triggers chain compaction
- Verified debug file I/O removal does not affect test assertions
- Ran full quality gate: format, lint, type-check, and all tests pass
