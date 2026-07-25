# Synthetic-alignment fixtures (Issue #2615)

Hand-minimised parent fixtures used by
[`test/breed/SyntheticLocationE2E.ts`](../../SyntheticLocationE2E.ts) to drive
the end-to-end regression for the synthetic-UUID alignment fallback wired into
`createCompatibleFatherFromCreatures` (delivered by Issue #2614).

## Provenance

The fixtures are inspired by the production cross-island breed problem first
reported in Issue #2609:

- `parent-mother.json` — modelled on the production cluster's `network.json`
  shape (cascading layered topology, fan-in to a deep hidden neuron, a shortcut
  hidden neuron from `input-0` directly to `output-1`).
- `parent-father.json` — modelled on the GRQ-teams Europa creature shape (same
  overall layered topology, deliberately disjoint hidden-neuron real UUIDs).

Both creatures expose the same alignment problem the production crossover hit on
the GitHub fleet: real-UUID overlap of `0.0` (well below the
`syntheticAlignmentThreshold` of `0.2`), but a topology similar enough that
location-anchored synthetic UUIDs match across all hidden neurons.

## Licence

These fixtures are **hand-crafted** for the regression test. They are NOT a copy
of the original production creatures (which are licence-encumbered and
considerably larger). The synapse weights, biases, and squash functions are
deliberately small and deterministic — the test asserts on alignment counts and
export hygiene, not on inference values.

The two files are intentionally < 200 KB each (each is well under 5 KB) so the
test stays hermetic and quick to load.
