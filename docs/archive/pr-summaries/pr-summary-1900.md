## Summary

Implement automatic noise injection (fuzzing) on training data during the
training loop to prevent networks from memorising exact training examples. This
is a standard regularisation technique (also called input perturbation) that
forces the network to learn general patterns rather than exact data points.
Closes #1900.

### Changes

- **`src/config/DataFuzzingConfig.ts`** - New config following the established
  three-type pattern (interface, Required type, defaults). Fields: `enabled`,
  `inputNoiseScale`, `outputNoiseScale`, `noiseType`.
- **`src/propagate/DataFuzzing.ts`** - `applyNoise()` utility that perturbs a
  Float32Array in-place using Gaussian (Box-Muller transform) or uniform noise
  distributions.
- **Config wiring** - Added `dataFuzzing` to `NeatArguments`, `NeatOptions`,
  `NeatOptionsInput`, `NeatConfig`, `TrainOptions`, and `NeatScheduling`.
- **Training integration** - Noise injection in `trainDirBinary()` (standard
  backpropagation) and `trainWithPredictiveCoding()`, applied per-sample after
  buffer copy and before activation.
- **Public API** - Exported `DataFuzzingConfig`, `RequiredDataFuzzingConfig`,
  and `DEFAULT_DATA_FUZZING_CONFIG` from `mod.ts`.

### Design decisions

- Disabled by default (`enabled: false`) for full backward compatibility.
- Noise is freshly generated per record per iteration to prevent the network
  learning noise patterns.
- Input and output noise scales are independently controllable (output noise at
  0 means no label perturbation).
- Uses existing `getRandomNumberGenerator()` for reproducibility when seeded.

## Evidence

All 4739 tests pass. `./quality.sh` succeeds with exit code 0.

## Test Plan

- **Unit tests** (`test/propagate/DataFuzzing.ts` - 14 tests):
  - Config defaults and parsing (defaults, overrides, string coercion, invalid
    noiseType)
  - Zero scale does not modify buffer
  - Gaussian noise: mean near zero, std dev matches scale, odd-length buffer
    handling
  - Uniform noise: bounded within [-scale, +scale], mean near zero
  - Single-element buffer handling
  - Reproducibility with same seed, different seeds produce different noise
- **Integration tests** (`test/propagate/DataFuzzingIntegration.ts` - 5 tests):
  - Training completes with Gaussian fuzzing enabled
  - Training completes with uniform fuzzing enabled
  - Training with fuzzing disabled behaves normally
  - Inference does not apply fuzzing (deterministic outputs)
  - Training with output noise (label smoothing) produces valid results
