# PR Summary: WASM Migration Phase 6 - Remove Deprecated JS Activation Code

**Issue:** #1123 **Phase:** 6 (Final)

## Overview

This PR completes the WASM migration by removing all legacy JavaScript dynamic
activation code generation. WASM is now the sole activation implementation for
the NEAT-AI neural network library.

## Changes

### Deleted Files

| File                                              | Description                                  |
| ------------------------------------------------- | -------------------------------------------- |
| `src/optimize/MakeCreatureActivationFunction.ts`  | JS creature activation code generator        |
| `src/optimize/MakeNeuronActivation.ts`            | JS neuron activation code generator          |
| `src/optimize/InlineSquashInterface.ts`           | Interface for inline squash functions        |
| `src/optimize/InlineActivationInterface.ts`       | Interface for inline activation functions    |
| `src/optimize/FunctionCache.ts`                   | Function caching for dynamic JS code         |
| `src/optimize/MakeActivationFunctionInterface.ts` | Interface for activation function generation |
| `test/SquashLookupTable.ts`                       | Tests for JS code generation                 |
| `bench/SquashLookupTableComparison.ts`            | Benchmark comparing JS implementations       |

### Modified Files

#### Core Changes

**`src/Creature.ts`**

- Removed import for `makeCreatureActivationFunction`
- Removed `creatureActivationFunction` and `creatureActivationResult` properties
- Simplified `prepareNeurons()` to only prepare neurons without JS code
  generation
- Updated `activate()` and `activateAndTrace()` to throw error if WASM
  unavailable
- Made WASM the sole activation implementation (no JS fallback)

**`src/architecture/Neuron.ts`**

- Removed imports for `FunctionCache` and `MakeActivationFunctionInterface`
- Removed `functionCache` property and `makeFunction()` method
- Added `activateLinear()` method as static replacement for dynamic function
- Updated `prepare()` to use `activateLinear` instead of `makeFunction()`

#### Aggregate Functions

**`src/methods/activations/aggregate/IF.ts`**, **`MAXIMUM.ts`**,
**`MINIMUM.ts`**

- Removed `inlineActivation()` method
- Removed `makeActivationFunction()` method
- Removed interface implementations for inline code generation

#### Activation Types (13 files)

**Files:** `TANH.ts`, `TAN.ts`, `STEP.ts`, `SINE.ts`, `ReLU.ts`, `ReLU6.ts`,
`HARD_TANH.ts`, `BIPOLAR.ts`, `COMPLEMENT.ts`, `Cosine.ts`, `ABSOLUTE.ts`,
`ArcTan.ts`, `IDENTITY.ts`

- Removed `InlineSquashInterface` import and implementation
- Removed `inlineSquash()` method from each

#### Deprecated Files

**`src/deprecated/HYPOT.ts`**, **`src/deprecated/HYPOTv2.ts`**

- Removed inline code generation methods and interfaces

### Test Updates

**WASM Test Files**

- `test/WasmActivation.ts` - Already using correct API
- `test/WasmActivateAndTrace.ts` - Rewritten to test WASM-only activation
- `test/WasmDefaultActivation.ts` - Rewritten to test WASM-only activation
- `test/CreatureWasmActivation.ts` - Updated to remove `useJs` parameter tests

**Simplify/Optimise Tests**

- Updated 12 test files to use async `await Deno.mkdir()` and
  `await Deno.writeTextFile()`
- Added `await initWasmActivation()` where needed
- Removed tests that specifically tested JS vs WASM comparison

**Discovery Tests**

- Added WASM initialisation to tests that call `creature.activate()`
- Updated `quality.sh` to enable WASM auto-init (`NEAT_AI_WASM_AUTO_INIT=1`)
- Added `--allow-ffi` permission for discovery tests that require WASM

### API Changes

**Before (with JS fallback):**

```typescript
// 4-parameter signature with useJs flag
activate(input, feedbackLoop, reuseBuffer, useJs);
activateAndTrace(input, feedbackLoop, sparseConfig, reuseBuffer, useJs);
```

**After (WASM only):**

```typescript
// 3-parameter signature (WASM required)
activate(input, feedbackLoop?, reuseBuffer?)
activateAndTrace(input, feedbackLoop?, sparseConfig, reuseBuffer?)
```

### Breaking Changes

1. **WASM is now required** - Applications must initialise WASM before calling
   `activate()` or `activateAndTrace()`
2. **`useJs` parameter removed** - The 4th parameter for `activate()` and 5th
   parameter for `activateAndTrace()` no longer exist
3. **No JS fallback** - If WASM fails to initialise, activation throws an error
   instead of falling back to JS

### Migration Guide

1. Ensure WASM is initialised before any activation:
   ```typescript
   import { initWasmActivation } from "@stsoftware/neat-ai/wasm/WasmActivation";
   await initWasmActivation();
   ```

2. Remove `useJs` parameter from `activate()` calls:
   ```typescript
   // Before
   creature.activate(input, false, false, true); // useJs=true

   // After
   creature.activate(input, false, false); // WASM only
   ```

3. Update `activateAndTrace()` calls similarly:
   ```typescript
   // Before
   creature.activateAndTrace(input, false, sparseConfig, false, true);

   // After
   creature.activateAndTrace(input, false, sparseConfig, false);
   ```

## Testing

All 1400+ functional tests pass with WASM activation. The changes have been
validated against the existing test suite to ensure backwards compatibility for
all neural network operations.

## Performance

WASM activation provides significant performance benefits over the legacy JS
code generation approach, particularly for larger networks. This change
consolidates the codebase on the faster implementation.
