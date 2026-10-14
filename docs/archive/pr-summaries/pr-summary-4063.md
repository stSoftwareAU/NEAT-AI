# Fix flaky MakeUuidDirectConstruction squash test (#4063)

## Summary

Closes #4063.

The test
`makeUUID direct construction — different squash produces different UUIDs` built
two independent random `Creature(3, 1, { layers: [{ count: 2 }] })` instances
and copied biases and weights index by index. Random wiring can give the two
creatures different synapse counts, so `creature1.synapses[i]` ran past the end
and threw `TypeError: Cannot read properties of undefined (reading 'weight')`.
`creature2` is now built from `creature1.exportJSON()` and only the hidden
neuron's squash is changed, so the structure is identical by construction.

## Spec

### Requirements

- Remove the dependence on two random creatures having equal synapse counts.
- Keep asserting that a different squash yields a different creature UUID.

### Approach

Test-only change in `test/architecture/MakeUuidDirectConstruction.ts`.
`creature2 = Creature.fromJSON(creature1.exportJSON())`, an unchanged-copy
control assertion that the UUID matches, then `setSquash("TANH")` on one neuron,
`delete creature2.uuid` and recompute.

### Out of scope

No production code change; no change to UUID derivation.

## Evidence

- `deno test` on `test/architecture/MakeUuidDirectConstruction.ts`: 8 passed, 0
  failed.
- Docs sweep: section: none — test-only change; siblings: none — no existing
  documented set gained a member.

## Reproduction

Regression test:
`test/architecture/MakeUuidDirectConstruction.ts::makeUUID direct construction — different squash produces different UUIDs`.

Status: reproduced against the old code (`HEAD~1`). A scratch loop constructing
the old pair of random creatures hit the failure on iteration 233 of up to 2000:
creature1 had 8 synapses, creature2 had 9, and
`creature2.synapses[i].weight = creature1.synapses[i].weight` threw
`TypeError: Cannot read properties of undefined (reading 'weight')`. The scratch
file was deleted. The new test cannot hit this because it never builds a second
random creature.

## Test Plan

- Removed assertions/code: the independent random `creature2` construction and
  both index-aligned copy loops (biases and weights); they were the source of
  the overrun and are replaced by the JSON copy.
- Added: an unchanged-copy control assertion
  (`An unchanged copy should share the UUID`).
- Red-check A (squash line commented out): fails with
  `Expected actual ... not to be ...: Different squash functions should produce different UUIDs`
  (7 passed, 1 failed); restored.
- Red-check B (added
  `creature2.neurons[creature2.input].bias += 1; delete creature2.uuid;` before
  the control assertion): fails with
  `Values are not equal: An unchanged copy should share the UUID` (7 passed, 1
  failed); restored.
- Callers/siblings: no production callers touched; other tests in the file
  unchanged and still pass.

<!-- vibe-quality-gate-skipped reason="./quality.sh could not run because no native rust_scorer binary is available (checked PATH and ../NEAT-AI-scorer/target/release/rust_scorer; neither exists) and there is no WASM fallback; targeted evidence instead: deno test test/architecture/MakeUuidDirectConstruction.ts gave 8 passed, 0 failed, and deno fmt --check, deno lint and deno check were run on the changed test file" -->

<!-- vibe-branch-outcomes -->

Branch outcomes: none added

## Security self-check

- No secrets staged; no new input handling, shell, filesystem or HTTP surface;
  no new dependencies.
