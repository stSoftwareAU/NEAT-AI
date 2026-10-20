# Fix flaky CreatureTrace banner test with a fixed-weight fixture

## Summary

Closes #4091.

The `mod.ts` banner test "CreatureTrace adds trace state only after activation"
(`test/docs/ModExportBanners.ts`) built a random
`new Creature(2, 1, { layers: [{ count: 2 }] })`. Now and then the random output
squash (STEP, BIPOLAR, SELU, GAUSSIAN) already produced the target `1`, or had a
zero gradient there. The error was then zero, no synapse was updated, and no
synapse trace was recorded. The test now loads a fixed `CreatureExport` with two
LOGISTIC hidden neurons and an IDENTITY output, so the error is always non-zero.
This is a test-only change; every assertion is kept.

## Spec

### Intent and Rationale

- `CreatureState` records a synapse trace only when `SynapseState.count > 0`.
  When the error is zero, every neuron reports no change, so
  `traced.synapses.some((s) => s.trace !== undefined)` fails.
- The issue suspected a numerical bug in NEAT-AI-core. A probe showed the
  failures were zero error or zero gradient from the random squash, so core is
  not changed.
- A fixed fixture removes the randomness the test never meant to exercise.
  Loosening the assertion would hide the property the banner documents.

### Essential Design Decisions

- The output squash is IDENTITY, so it cannot saturate and always has gradient
  1.
- With the fixed weights and input `[0.5, 0.25]`, the output activation is about
  0.15, far from the target `1`, so the error is non-zero.
- The neurons and synapses are UUID-only (`input-N`, `output-0`, `hidden-a`,
  `hidden-b`), matching the wire format. `Creature.fromJSON` loads it unchanged.

### Undiscoverable Facts

- A probe that repeated the base test logic with random creatures failed 11 of
  3000 runs (STEP and BIPOLAR outputs) in one session, and 6 of 3000 in another.
  The second run's output squashes were BIPOLAR, SELU, STEP, BIPOLAR, STEP and
  GAUSSIAN.
- The same probe with the fixed fixture failed 0 of 5000 runs.

## Evidence

- `deno test -A test/docs/ModExportBanners.ts` — `ok | 12 passed | 0 failed`.
- The test file looped 30 times — 30 of 30 passed.
- Full gate:
  `./quality.sh --rust-scorer-bin=/var/tmp/vibe-cargo-target/NEAT-AI-a155970c/release/rust_scorer < /dev/null`
  — 9967 passed, 0 failed, 41 ignored (13m48s).
- Docs sweep: grep: "CreatureTrace", "ModExportBanners"; section: none — no
  manual documents this test's fixture; siblings: none — no existing set gained
  a member.

## Reproduction

- Symptom: the synapse-trace assertion in "mod.ts banner — CreatureTrace adds
  trace state only after activation" failed in about 0.2–0.4% of runs.
- Status: partial — the base flake is probabilistic; it is shown by a 3000-run
  probe (6 failures), not by a deterministic red test.
- Regression test:
  `test/docs/ModExportBanners.ts::mod.ts banner — CreatureTrace adds trace state only after activation`.

## Test Plan

- [x] Modified test: `test/docs/ModExportBanners.ts` — "mod.ts banner —
      CreatureTrace adds trace state only after activation" now uses a
      fixed-weight fixture. No assertion was removed.
- [x] Red check (edited expectation, partial): the random-creature version
      failed 6 of 3000 probe runs; the fixed fixture failed 0 of 5000.
- [x] `deno test -A test/docs/ModExportBanners.ts` — 12 passed.
- [x] Full `./quality.sh` gate — 9967 passed, 0 failed, 41 ignored.
- [x] The gate needed a locally built native `rust_scorer`, passed with
      `--rust-scorer-bin`. The first `cargo build` exited 2 after printing
      "Finished"; a re-run exited 0.

<!-- vibe-branch-outcomes -->
