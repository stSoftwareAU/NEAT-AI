## Summary

Implements WASM Migration Phase 4: `activateAndTrace` for WASM with backpropagation support (Issue #1121).

This enables WASM-accelerated training, not just inference. The `activateAndTrace()` method records which synapses were "used" during activation, which is critical for gradient calculation during backpropagation.

### Key Changes

1. **Rust WASM Module** (`wasm_activation/src/lib.rs`)
   - Added `activate_and_trace()` method that returns:
     - Output activation values
     - Post-squash activations for all non-input neurons
     - Pre-squash values (hintValues) for backpropagation
     - Trace data for aggregate functions (MINIMUM, MAXIMUM, IF)
   - Trace data encoding:
     - For MINIMUM/MAXIMUM: local synapse index of the winning synapse
     - For IF: branch taken (1.0 = positive, 0.0 = negative)

2. **TypeScript WASM Wrapper** (`src/wasm/WasmActivation.ts`)
   - Added `activateAndTrace()` method to `WasmCreatureActivation` class
   - Added `WasmTraceResult` and `WasmTraceEntry` interfaces
   - Parses WASM output to extract activations, hintValues, and trace data

3. **Creature Class Integration** (`src/Creature.ts`)
   - Updated `activateAndTrace()` to use WASM when `useWasm=true` and available
   - Added `activateAndTraceWasm()` private method for WASM-based activation with tracing
   - Added `applyWasmTraceData()` method to set synapse usage flags from WASM trace data

### Trace Behaviour

The trace data indicates which synapses were "used" during activation:
- **Standard squash functions**: All synapses are marked as used
- **MINIMUM**: Only the synapse providing the minimum value is marked as used
- **MAXIMUM**: Only the synapse providing the maximum value is marked as used
- **IF**: Condition synapses + active branch (positive/negative) synapses are marked as used

## Evidence

Unable to generate screenshot: This is a backend neural network library with no visual interface.

The implementation has been verified through comprehensive tests that ensure WASM trace behaviour matches JavaScript implementation exactly.

## Test Plan

Added new test file `test/WasmActivateAndTrace.ts` with 10 tests:

1. **WASM activateAndTrace: Module initialisation** - Verifies WASM module loads
2. **WASM activateAndTrace: Returns same activation values as JS** - Verifies output values match
3. **WASM activateAndTrace: MINIMUM trace behaviour matches JS** - Verifies MINIMUM synapse usage flags and applyLearnings behaviour
4. **WASM activateAndTrace: MAXIMUM trace behaviour matches JS** - Verifies MAXIMUM synapse usage flags and applyLearnings behaviour
5. **WASM activateAndTrace: IF trace behaviour matches JS (positive branch)** - Verifies IF positive branch trace
6. **WASM activateAndTrace: IF trace behaviour matches JS (negative branch)** - Verifies IF negative branch trace
7. **WASM activateAndTrace: Standard squash marks all synapses as used** - Verifies standard neurons mark all synapses
8. **WASM activateAndTrace: Multiple iterations produce consistent results** - Verifies consistency across multiple activations
9. **WASM activateAndTrace: hintValue is correctly set for backpropagation** - Verifies pre-squash values are correctly returned
10. **WASM activateAndTrace: Complex network with mixed squash functions works correctly** - End-to-end test with mixed activation types

### Existing Tests

All 1546 existing tests pass without modification, including:
- `test/TraceAggregate.ts` (3 tests) - Existing trace aggregate tests
- `test/CreatureWasmActivation.ts` (17 tests) - Existing WASM activation tests
