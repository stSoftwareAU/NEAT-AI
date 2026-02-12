## Summary

Extract shared base utilities for mutation operators in `src/mutate/` to eliminate duplicated patterns. Closes #1396.

Created `src/mutate/MutationUtils.ts` with four shared helpers:

- **`selectFocusedNeuronIndex`**: Focus-aware neuron selection with retry and relaxation — replaces identical 12-attempt loops in `ModBias` and `ModSquash`
- **`cleanupDisconnectedNeuron`**: Orphaned neuron cleanup (remove completely disconnected, or convert to constant) — replaces duplicate ~20-line blocks in `SubSelfCon` and `SubBackCon`
- **`validateAndBumpForwardOnly`**: Forward-only validation with version-aware error handling and version bumping — replaces two duplicate try/catch blocks in `AddConnection`
- **`bumpToFourIfForwardOnlyConfirmed`**: Semantic version bump helper (2.x/3.x → 4.0.0)

### Files changed

| File | Change |
|------|--------|
| `src/mutate/MutationUtils.ts` | **New** — shared utility module |
| `test/mutate/MutationUtils.ts` | **New** — 13 tests for all utility functions |
| `src/mutate/AddConnection.ts` | Replaced 2 duplicated validation blocks with `validateAndBumpForwardOnly` |
| `src/mutate/ModBias.ts` | Replaced selection loop with `selectFocusedNeuronIndex` |
| `src/mutate/ModSquash.ts` | Replaced selection loop with `selectFocusedNeuronIndex` |
| `src/mutate/SubSelfCon.ts` | Replaced cleanup block with `cleanupDisconnectedNeuron` |
| `src/mutate/SubBackCon.ts` | Replaced cleanup block with `cleanupDisconnectedNeuron` |

Net reduction: **~117 lines** removed across 5 mutation files (143 deletions, 26 insertions in existing files).

## Evidence

This is a pure refactoring with no UI changes. All 2597 existing tests pass, confirming behaviour is preserved. The refactoring was validated by:

- Running all mutation-specific tests (32 tests across ModBias, ModSquash, SubSelfCon, SubBackCon, AddConnection, and related test files)
- Running forward-only validation tests (MutatorDoesNotCorruptForwardOnlyFourX, MutatorRepairsForwardOnlyFourXCorruption)
- Running the full `quality.sh` gate (fmt, lint, type-check, all 2597 tests)

## Test Plan

- Added `test/mutate/MutationUtils.ts` with 13 tests covering:
  - `selectFocusedNeuronIndex`: selects non-input neurons, skips constants, respects focus list, handles edge cases
  - `cleanupDisconnectedNeuron`: removes disconnected neurons, converts to constant, preserves connected neurons, ignores non-hidden
  - `bumpToFourIfForwardOnlyConfirmed`: bumps 2.x/3.x to 4.0.0, preserves 4.x
  - `validateAndBumpForwardOnly`: validates and bumps valid creatures, preserves existing 4.x versions
- All existing mutation tests continue to pass unchanged
