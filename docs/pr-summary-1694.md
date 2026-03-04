## Summary

Replace all generic `throw new Error(...)` with appropriate typed error classes in the propagate, architecture, creature modules and Creature.ts. This enables callers to handle errors programmatically by catching specific error types and inspecting reason codes. Closes #1694.

### Changes by module

**propagate/**
- `ActivationRange.ts`: `Error` -> `ActivationError` with `NON_FINITE_RESULT` reason
- `Bias.ts`: `Error` -> `ValidationError` with `OTHER` reason for non-finite bias

**architecture/**
- `CreatureUtils.ts`: `Error` -> `ValidationError` for invalid creature objects
- `Fitness.ts`: `Error` -> `ValidationError` for invalid worker responses
- `Training.ts`: `Error` -> `ValidationError` for zero-sample training
- `Neuron.ts`: `Error` -> `TopologyError` with `INVALID_STATE` for unimplemented stubs
- `DataSet.ts`: `Error` -> `ValidationError` for partition and length mismatches

**creature/**
- `CreatureActivation.ts`: `Error` -> `WasmError` for WASM loading/activation failures
- `CreatureTraining.ts`: `Error` -> `TopologyError` with `EXCESSIVE_ERRORS` reason

**Creature.ts**
- Input validation: `Error` -> `ActivationError` with `NON_FINITE_INPUT` reason
- Connection validation: `Error` -> `TopologyError` with `INVALID_CONNECTION` reason

## Evidence

Backend-only change with no visual output. All 4373 tests pass including 9 new typed error tests.

## Test Plan

New test files verifying correct error types are thrown:
- `test/propagate/ActivationRangeTypedErrors.ts` - ActivationError for validate/limit
- `test/propagate/BiasTypedErrors.ts` - ValidationError for non-finite bias
- `test/architecture/CreatureUtilsTypedErrors.ts` - ValidationError for invalid creatures
- `test/architecture/DataSetTypedErrors.ts` - ValidationError for partition/length mismatches
- `test/architecture/FitnessTypedErrors.ts` - ValidationError for invalid worker response
- `test/architecture/NeuronTypedErrors.ts` - TopologyError for unimplemented stubs
- `test/creature/CreatureTypedErrors.ts` - ActivationError and TopologyError for Creature methods
- `test/creature/CreatureActivationTypedErrors.ts` - WasmError verification
- `test/creature/CreatureTrainingTypedErrors.ts` - TopologyError EXCESSIVE_ERRORS

Updated existing test:
- `test/validate/ActivationRange.ts` - Updated to expect `ActivationError` name
