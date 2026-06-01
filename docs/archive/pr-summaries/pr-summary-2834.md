## Summary

Removed hard-coded UUID-hash neuron IDs from the `test/compact/` tests so the
assertions describe the *observable* behaviour (which neuron/synapse survives,
identified by its stable UUID) rather than coupling to the internal
UUID→integer hashing routine. The magic integers (`217046707`, `4227520`,
`550257383`, and the two converted-constant ids `1640249334` / `890998550`) are
implementation details — a behaviour-preserving change to the hashing algorithm
would have broken these tests even though pruning/orphan-removal still works.
This was a HOW-test refactoring blocker (anti-pattern: hard-coded magic values).

Closes #2834.

## Changes

- `test/compact/CleanupOrphanedNeurons.ts`
  - Orphan-removal: identify the removed neuron/synapse by `uuid === "orphan-hidden-1"` / `toUUID === "orphan-hidden-1"` instead of the hashed id `217046707`.
  - Hidden→constant conversion (both LOGISTIC and TANH cases): locate the converted neuron as the sole `type === "constant"` neuron rather than by the hashed ids `1640249334` / `890998550`. (Conversion drops the source UUID, so the observable property is the neuron's type.)
- `test/compact/ZeroWeightSynapsePruningTyped.ts`
  - Count IF inbound synapses by `toUUID === "if-0"` instead of `toId === 4227520`.
- `test/compact/ZeroWeightSynapsePruning.ts`
  - Assert the orphaned hidden neuron is gone by `uuid === "hidden-unused"` instead of `id === 550257383`.

No production code changed — these are test-only assertion refactors that preserve the behaviour being verified.

## Evidence

Backend/test-only change — no UI to screenshot. Verified by running the three
affected test files and the full quality gate.

```
deno test test/compact/CleanupOrphanedNeurons.ts \
          test/compact/ZeroWeightSynapsePruningTyped.ts \
          test/compact/ZeroWeightSynapsePruning.ts
ok | 11 passed | 0 failed

./quality.sh
ok | 7024 passed (2 steps) | 0 failed | 4 ignored
```

## Test Plan

- `test/compact/CleanupOrphanedNeurons.ts` — 9 tests pass with UUID/type-based assertions.
- `test/compact/ZeroWeightSynapsePruningTyped.ts` — IF-target preservation verified via `toUUID`.
- `test/compact/ZeroWeightSynapsePruning.ts` — behaviour-preserving compaction verified via `uuid`.
- Full `./quality.sh` (fmt, lint, type-check, all tests) passes cleanly.
