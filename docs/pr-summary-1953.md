## Summary

Remove duplicate TypeScript fallback code for weight/bias WASM calculations,
enforcing WASM as the single source of truth. Closes #1953.

### Changes

- **Rust WASM** (`wasm_activation/src/accumulate.rs`): Added L1/L2
  regularisation to `limit_weight()` and `limit_bias()` via new
  `apply_weight_regularisation()` and `apply_bias_regularisation()` helper
  functions. Extended `calculate_weight()` and `calculate_bias()` signatures
  with `l1_weight_decay`/`l2_weight_decay` and `l1_bias_decay`/`l2_bias_decay`
  parameters.

- **Weight.ts**: Removed `calculateWeightTS()`, `limitWeight()`, and
  `applyWeightRegularisation()`. `calculateWeight()` now calls WASM exclusively.

- **Bias.ts**: Removed the TypeScript fallback block in `calculateBias()`,
  `limitBias()`, and `applyBiasRegularisation()`. `calculateBias()` now calls
  WASM exclusively.

- **WasmStandaloneFunctions.ts**: `wasmCalculateWeight()` and
  `wasmCalculateBias()` now throw `WasmError` instead of returning `undefined`.
  Return types updated from `number | undefined` to `number`. Both functions
  now pass L1/L2 decay config values to the WASM layer.

- **WasmModuleLoader.ts**: Updated type signatures for
  `calculateWeightWasmFn` and `calculateBiasWasmFn` to include
  `l1WeightDecay`/`l2WeightDecay` and `l1BiasDecay`/`l2BiasDecay` parameters.

### Test changes (documented per policy)

The following test files were **removed** because they exclusively tested
functions that no longer exist (`limitWeight`, `limitBias`,
`applyWeightRegularisation`, `applyBiasRegularisation`). The equivalent logic
is now tested by Rust unit tests in `accumulate.rs`:

- `test/propagate/WeightRegularisation.ts` — tested TS `limitWeight` with L1/L2
- `test/propagate/BiasRegularisation.ts` — tested TS `limitBias` with L1/L2
- `test/propagate/BiasTypedErrors.ts` — tested TS `limitBias` ValidationError

The `limitWeight` tests in `test/propagate/Weight.ts` and `limitBias` tests in
`test/propagate/Bias.ts` were also removed for the same reason. All
`accumulateWeight`, `accumulateBias`, and `calculateWeight` tests remain.

## Evidence

- All 4826 tests pass (`./quality.sh`)
- All 206 Rust unit tests pass (`cargo test`), including new L1/L2
  regularisation tests for both weight and bias

## Test Plan

- Rust: `test_weight_l2_regularisation`, `test_weight_l1_regularisation`,
  `test_bias_l2_regularisation`, `test_bias_l1_regularisation`,
  `test_calculate_weight_with_l2_decay`, `test_calculate_bias_with_l2_decay`
- Existing TS tests for `accumulateWeight`, `accumulateBias`, and
  `calculateWeight` continue to pass unchanged
- Full quality gate (`./quality.sh`) passes
