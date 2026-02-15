## Summary

Migrate all raw `throw new Error(...)` calls in activation function files to typed `ActivationError` class. This enables downstream code to catch specific error types (e.g., `catch (e) { if (e instanceof ActivationError) ... }`) and provides structured error information including the activation name, input value, and failure reason. Closes #1486.

## Changes

- Created `src/errors/ActivationError.ts` with typed reasons: `NON_FINITE_INPUT`, `NON_FINITE_RESULT`, `UNKNOWN_ACTIVATION`
- Migrated 17 `throw new Error(...)` calls across 16 activation files to `throw new ActivationError(...)`
- Files updated:
  - `src/methods/activations/Activations.ts` (unknown activation lookup)
  - `src/methods/activations/types/`: ReLU, TANH, Mish, Softplus, TAN, LogSigmoid, COMPLEMENT, STEP, SOFTSIGN, ReLU6, HARD_TANH, LeakyReLU, LOGISTIC, SINE, ArcTan

## Evidence

This is a backend-only refactor with no UI changes. All 3808 existing tests continue to pass. New tests verify correct error types are thrown.

## Test Plan

- Added `test/errors/ActivationError.ts` (8 tests) verifying the ActivationError class: construction, instanceof checks, reason typing, selective catching, array inputs
- Added `test/methods/activations/ActivationErrorIntegration.ts` (48 tests) verifying:
  - All 14 activation functions with derivative guards throw `ActivationError` for NaN, Infinity, and -Infinity
  - `TAN.unSquash()` throws `ActivationError` for non-finite activation
  - `Activations.find()` throws `ActivationError` for unknown activation names
  - Error properties (`reason`, `activation`, `input`) are correctly populated
  - Finite inputs still work correctly (ArcTan derivative sanity check)
