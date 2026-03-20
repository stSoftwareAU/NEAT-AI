## Summary

Implement automatic quantisation of training data values during the training
loop to reduce precision and prevent networks from memorising exact training
examples. Quantisation rounds continuous values to a finite set of discrete
levels, forcing the network to learn robust mappings. Closes #1901.

This is the deterministic complement to data fuzzing (#1900) — both can be used
together for stronger memorisation prevention.

## Changes

- **`src/config/DataQuantisationConfig.ts`** — New config following the
  three-type pattern (interface, Required type, defaults). Fields: `enabled`,
  `inputLevels` (2–65536, default 256), `outputLevels` (0 or 2–65536, default 0
  = disabled).
- **`src/propagate/DataQuantisation.ts`** — `quantiseBuffer()` utility that
  quantises a Float32Array in-place by mapping [min, max] to evenly spaced bin
  centres.
- **`src/config/NeatArguments.ts`** — Added `dataQuantisation` field.
- **`src/config/NeatOptions.ts`** — Added to both `NeatOptions` and
  `NeatOptionsInput` types with `CoerceNumeric<>` for CLI support.
- **`src/config/NeatConfigParsers.ts`** — Added `parseDataQuantisation()` parser
  with validation.
- **`src/config/NeatConfig.ts`** — Wired parser into `createNeatConfig()`.
- **`src/config/TrainOptions.ts`** — Added `dataQuantisation` to
  `TrainArguments`.
- **`src/architecture/Training.ts`** — Applied quantisation in
  `trainDirBinary()` after buffer copy and before fuzzing/activation.
- **`src/predictiveCoding/PredictiveCodingTrainer.ts`** — Applied quantisation
  in `trainWithPredictiveCoding()` data loop.

## Evidence

- All 4755 tests pass (0 failed)
- `./quality.sh` passes cleanly
- Quantisation is disabled by default — no behaviour change unless opted in

## Test Plan

- `test/propagate/DataQuantisation.ts` — 16 tests covering:
  - Config defaults verification
  - Config parser: defaults, overrides, string coercion, outputLevels=0
  - `quantiseBuffer`: basic snapping, 2 levels, level count respected
  - Edge cases: single value, all identical, two values, empty buffer
  - Negative range (-1 to 1)
  - Determinism (same input => same output)
  - Min/max preservation
  - Values stay within original range
