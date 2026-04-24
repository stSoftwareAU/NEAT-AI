## Summary

Proactively clamp weight/bias magnitudes at every in-memory write site so a
runaway value can no longer compound through scoring, mutation decisions, and
serialisation between saves. Closes #2421.

Issue #2378/#2384 added a reactive clamp inside
`CreatureSerialization.loadFrom`, but production logs showed values reaching
`1.1559466326634707e+195` in memory before the next save/reload cycle. The
load-time clamp is a safety net; this change makes the clamp a fence at the
write sites themselves.

### What changed

- New module `src/utils/OverflowGuardStats.ts` exposes
  `clampAndTrack(value,
  source, context?)`. It wraps `clampWeightBiasDetail`,
  keeps a per-source counter, and emits a single `debug` log line when clamping
  actually fires. `getOverflowGuardStats()` / `resetOverflowGuardStats()`
  support per-run telemetry and test isolation.
- `src/mutate/ModWeight.ts`, `src/mutate/ModBias.ts`, `src/mutate/AddNeuron.ts`,
  and `src/mutate/AddConnection.ts` now route every weight/bias assignment
  through `clampAndTrack` — even when regularisation limits are set to
  `Infinity`.
- Training propagation in `src/neuron/NeuronPropagation.ts::propagateUpdate`
  clamps the post-backprop weight and bias on both the coordinated and
  non-coordinated paths.
- `src/predictiveCoding/PredictiveCodingLearning.ts::applyHebbianUpdate` clamps
  the Hebbian-update weight and bias writes.
- Rust/WASM FFI ingestion paths
  (`src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts`,
  `DiscoveryNeuronAddition.ts`, `DiscoveryNeuronRemoval.ts`,
  `DiscoverySynapseOps.ts`) clamp every weight/bias supplied by Rust discovery
  candidates before it lands on the creature.

The clamp is a defence-in-depth guard: under healthy conditions the counter
stays at zero. A steadily non-zero `OverflowGuardStats.total` points at a
still-unfixed propagation bug upstream of the clamp.

## Evidence

Backend-only change — no UI. Verified via tests:

- `test/utils/OverflowGuardStats.ts` — 6 unit tests covering counter increments,
  per-source isolation, reset, and defensive-copy semantics.
- `test/mutate/ProactiveWeightBiasClamp.ts` — 4 integration tests that:
  1. Seed a weight just below `MAX_SAFE_INTEGER`, set the regulariser's
     `maxAbsoluteWeight` to `Infinity`, and run 200 `ModWeight.mutate()` calls.
     The new guard keeps `|weight| ≤ MAX_SAFE_WEIGHT_BIAS` throughout and fires
     at least once.
  2. Same shape for `ModBias` with `maxAbsoluteBias = Infinity`.
  3. Force a pathological Hebbian update (`delta = 1e200`) and assert the post-
     update weight and bias land on `MAX_SAFE_WEIGHT_BIAS` and the counters
     register exactly one event each.
  4. Smoke-test `clampAndTrack` direct usage.
- Existing `test/creature/WeightBiasOverflowClamp.ts` still passes (load-time
  clamp behaviour unchanged).

Full quality gate passes:

```
./quality.sh --skip-discovery --skip-wasm
...
ok | 6207 passed (2 steps) | 0 failed | 3 ignored (1m26s)
```

## Test Plan

- `deno test --allow-all test/utils/OverflowGuardStats.ts` — 6 tests.
- `deno test --allow-all test/mutate/ProactiveWeightBiasClamp.ts` — 4 tests.
- `deno test --allow-all test/mutate/*.ts` — 178 existing mutate tests still
  pass.
- `deno test --allow-all test/predictiveCoding/*.ts` — 76 PC tests still pass.
- `deno test --allow-all test/discovery/*.ts test/ErrorGuidedStructuralEvolution/*.ts test/creature/`
  — 659 discovery / creature tests still pass.
- Full `./quality.sh --skip-discovery --skip-wasm` — 6207 tests pass.
