## Summary

This PR implements WASM Migration Phase 11, integrating the WASM activation
methods (from Phases 6-10) into the backpropagation code path. This is a
critical step that allows the training pipeline to use WASM methods for improved
performance.

### Key Changes

1. **Unified Wrapper Functions** (`src/wasm/ActivationMethods.ts`)
   - Created wrapper functions that delegate to either WASM or JS
     implementations
   - Functions: `calculateError()`, `safeZoneAdjustment()`, `unSquash()`,
     `squash()`
   - Added `shouldUseWasmBackprop()` to check environment configuration
   - Added `isWasmSquashSupported()` to check if a squash function has WASM
     support

2. **Neuron.ts Updates**
   - `propagate()`: Now uses WASM `calculateError()`, `safeZoneAdjustment()`,
     and `squash()`
   - `record()`: Now uses WASM `calculateError()`

3. **BackPropagation.ts Updates**
   - `toValue()`: Now uses WASM `unSquash()`
   - `toActivation()`: Now uses WASM `squash()`

4. **CompactUtils.ts Updates**
   - `cleanupOrphanedNeurons()`: Now uses WASM `squash()` for constant bias
     calculation

5. **Environment Variable Configuration**
   - `NEAT_AI_USE_WASM_BACKPROP`: Set to "false", "0", "no", or "off" to disable
     WASM backpropagation
   - Defaults to using WASM when available

### Backwards Compatibility

- All JS implementations remain as fallback when WASM is unavailable
- The wrapper functions automatically detect WASM availability
- No breaking changes to existing APIs

## Evidence

Unable to generate screenshot: This is a CLI library with no visual interface.

The implementation correctness is verified by:

1. All 1751 existing tests pass
2. New test suite `test/WasmBackpropagation.ts` verifies WASM backpropagation
   integration
3. `./quality.sh` passes cleanly

## Test Plan

New tests added in `test/WasmBackpropagation.ts`:

- **WASM Backpropagation: Module initialisation** - Verifies WASM module loads
  correctly
- **WASM Backpropagation: shouldUseWasmBackprop flag** - Tests environment
  variable handling
- **WASM Backpropagation: isWasmSquashSupported** - Verifies squash function
  support detection
- **WASM Backpropagation: squash function wrapper** - Tests squash wrapper
  delegation
- **WASM Backpropagation: unSquash function wrapper** - Tests unSquash wrapper
  delegation
- **WASM Backpropagation: calculateError function wrapper** - Tests
  calculateError wrapper delegation
- **WASM Backpropagation: safeZoneAdjustment function wrapper** - Tests
  safeZoneAdjustment wrapper delegation
- **WASM Backpropagation: Training iteration executes without error** - Verifies
  training pipeline works
- **WASM Backpropagation: Both networks produce same initial output** - Verifies
  WASM/JS consistency
- **WASM Backpropagation: All standard squash functions work with wrapper** -
  Tests all supported activations
- **WASM Backpropagation: Network with multiple squash types processes
  training** - Tests heterogeneous networks

### Acceptance Criteria Checklist

- [x] Unified wrapper functions created for all activation methods
- [x] Backpropagation uses WASM methods when available
- [x] Fallback to JS when WASM unavailable
- [x] Environment variable to force JS backprop
      (`NEAT_AI_USE_WASM_BACKPROP=false`)
- [x] Tests verify training works with WASM backprop
- [x] All existing tests pass
- [x] `./quality.sh` passes
