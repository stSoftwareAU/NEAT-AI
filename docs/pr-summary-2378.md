## Summary

During long-running GRQ evolve runs, `computeAndCacheScoreComponents()` in
`src/architecture/Score.ts` emitted `"Max is too large <n>"` / `"Total is too
large <n>"` info lines with values up to `1.15e+195`. The pre-existing clamp
hid the symptom after the fact but could not stop overflowing values from
persisting to disk, being reloaded, and compounding into subsequent
generations. The info-level lines also carried no creature identifier,
making the thousands of production log entries useless for tracing the
offending lineage.

This change:

1. Adds a shared `clampWeightBias` utility in `src/utils/WeightBiasClamp.ts`
   that caps `|value|` to `Number.MAX_SAFE_INTEGER` while preserving sign,
   and a `clampWeightBiasDetail` variant that reports whether clamping
   occurred.
2. Applies the clamp at load time in `CreatureSerialization.loadFrom` for
   every synapse weight and neuron bias (defence in depth, as suggested in
   the issue). A single aggregated `warn`-level log is emitted per load
   including the creature UUID and the counts of clamped values.
3. Upgrades the score-path overflow guard in `Score.ts` from `info` to
   `warn` and includes the creature UUID in the message.
4. Adjusts `test/compact/CompactUnusedFiniteGuard.ts` to inject extreme
   weight/bias values after load, so those tests still exercise
   `removeNeuron`'s overflow guard rather than the new load-time clamp.

Closes #2378.

## Evidence

This is a backend/library change with no web UI. Verification is via unit
tests:

- `test/utils/WeightBiasClamp.ts` — 14 direct unit tests for the clamp
  helper covering zero, small values, boundary (`MAX_SAFE_WEIGHT_BIAS`),
  overflow (positive and negative, including `1.15e+195` from the issue
  fixture), NaN, and ±Infinity passthrough.
- `test/creature/WeightBiasOverflowClamp.ts` — exercises
  `Creature.fromJSON()` end-to-end with the overflow weight from the
  issue fixture (`weight = 1.1559466326634707e+195`) and with an overflow
  bias, asserting both are clamped to `±MAX_SAFE_INTEGER` and that
  in-range values are preserved exactly.
- `test/score/WeightBiasOverflowWarning.ts` — captures the global logger
  and asserts that the score-path overflow guard emits a `warn`-level log
  that includes the creature UUID.

Full quality gate (`./quality.sh --skip-wasm --skip-discovery`): **5995
passed, 0 failed, 3 ignored** (previously one pre-existing test relied on
loading `Number.MAX_VALUE` weights via JSON; updated to inject those
values after load so it still exercises `removeNeuron`'s guard).

## Test Plan

- [x] Added `test/utils/WeightBiasClamp.ts` (14 cases).
- [x] Added `test/creature/WeightBiasOverflowClamp.ts` (4 cases covering
      the exact overflow magnitude from the issue fixture).
- [x] Added `test/score/WeightBiasOverflowWarning.ts` (asserts warn-level
      log contains creature UUID).
- [x] Updated `test/compact/CompactUnusedFiniteGuard.ts` to inject
      extreme values post-load so it continues to exercise
      `removeNeuron`'s overflow guard (behaviour preserved; only the test
      setup changed).
- [x] `./quality.sh --skip-wasm --skip-discovery` passes cleanly.
