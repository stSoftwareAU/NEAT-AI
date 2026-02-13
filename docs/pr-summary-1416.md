## Summary

Add bias regularisation during mutation to prevent exploding biases, mirroring the existing weight regularisation from Issue #1309. Previously, weight mutations had configurable regularisation (hard limits, L2 pull towards zero, small change preference) but bias mutations were completely unregulated - they could grow without bound. This asymmetry allowed biases to explode to extreme values (e.g., 1e+28 and 1e+195 as seen in the issue logs).

The implementation follows the established config pattern, adding a `BiasRegularisationConfig` that mirrors `WeightRegularisationConfig` with the same defaults (maxAbsoluteBias: 100, maxBiasChange: 10, l2Strength: 0.1, preferSmallChanges: true). This is backward compatible - the regularisation is enabled by default but can be disabled or tuned via the `biasRegularisation` option. Closes #1416.

## Changes

- **New:** `src/config/BiasRegularisationConfig.ts` - Configuration interface, required type, and defaults
- **Modified:** `src/mutate/ModBias.ts` - Enhanced with full regularisation logic (hard limits, L2, small change preference), matching `ModWeight`
- **Modified:** `src/config/NeatArguments.ts` - Added `biasRegularisation` field
- **Modified:** `src/config/NeatOptions.ts` - Added `biasRegularisation` to both `NeatOptions` and `NeatOptionsInput` types
- **Modified:** `src/config/NeatConfig.ts` - Added IIFE parsing block for `biasRegularisation`
- **Modified:** `src/NEAT/Mutator.ts` - Passes `biasRegularisation` config to `ModBias`

## Evidence

This is a backend/algorithm change with no visual output. Evidence is provided via the comprehensive test suite:

- All 2679 existing tests pass (0 failures)
- 11 new bias regularisation tests all pass
- Full `quality.sh` gate passes cleanly (lint, format, type-check, all tests)

## Test Plan

New test file `test/mutate/ModBiasRegularisation.ts` with 11 tests:

- `ModBias - respects maxAbsoluteBias hard limit` - Verifies biases never exceed configured maximum
- `ModBias - respects maxBiasChange hard limit` - Verifies per-mutation change is bounded
- `ModBias - L2 regularisation biases towards smaller biases` - Verifies L2 pull towards zero
- `ModBias - preferSmallChanges reduces mutation magnitude` - Verifies small change preference
- `ModBias - regularisation can be disabled` - Verifies backward compatibility when disabled
- `ModBias - default config provides sensible regularisation` - Verifies defaults enforce limits
- `ModBias - works without config (backward compatible)` - Verifies no-arg construction works
- `ModBias - clamps extreme initial biases to maxAbsoluteBias` - Verifies clamping of extreme values
- `ModBias - handles negative biases correctly with regularisation` - Verifies negative bias handling
- `ModBias - returns false when no valid neurons exist (with config)` - Verifies constant neuron protection
- `ModBias - focus list works with regularisation` - Verifies focus list integration
