# WASM Migration Phase 3: Implement MAXIMUM and MINIMUM aggregation in WASM

## Summary

This PR completes Phase 3 of the WASM migration series by adding comprehensive tests for MAXIMUM and MINIMUM aggregate activation functions in WASM. The core WASM implementation was already completed in Phase 0 (Issue #1125), so this PR focuses on verification testing to ensure the implementation meets all acceptance criteria.

### Background

MAXIMUM and MINIMUM are aggregate activation functions that:
- Take multiple weighted inputs and select the extreme value (max or min)
- Add bias after selection
- Are used for winner-take-all type neural network patterns
- Convert to IDENTITY when there's only 1 inward connection (handled by the `fix()` method)

### What was done

1. **Verified existing WASM implementation** - Confirmed that Phase 0 (Issue #1125) already implemented MAXIMUM and MINIMUM correctly in both:
   - `wasm_activation/src/lib.rs` - Rust WASM implementation with proper handling in both `activate()` and `activate_batch()` functions
   - `src/wasm/SquashType.ts` - TypeScript enum mappings (MINIMUM=32, MAXIMUM=33)

2. **Added comprehensive edge case tests** (13 new tests) for MAXIMUM and MINIMUM in `test/WasmActivation.ts`:
   - Batch activation tests for both functions
   - Many inputs tests (4+ inputs)
   - Negative weights tests
   - Zero values tests
   - Deep network tests (multiple layers)
   - Multiple aggregate neurons in a network
   - Combined MAXIMUM and MINIMUM network

## Evidence

This is a backend/WASM change with no visual interface. The evidence is the test suite passing:

```
running 35 tests from ./test/WasmActivation.ts
WASM Activation: Module initialisation ... ok
WASM Activation: MINIMUM squash function ... ok
WASM Activation: MAXIMUM squash function ... ok
...
WASM Activation: MAXIMUM batch activation ... ok
WASM Activation: MINIMUM batch activation ... ok
WASM Activation: MAXIMUM with many inputs ... ok
WASM Activation: MINIMUM with many inputs ... ok
WASM Activation: MAXIMUM with negative weights ... ok
WASM Activation: MINIMUM with negative weights ... ok
WASM Activation: MAXIMUM with zero values ... ok
WASM Activation: MINIMUM with zero values ... ok
WASM Activation: MAXIMUM in deep network ... ok
WASM Activation: MINIMUM in deep network ... ok
WASM Activation: Multiple MAXIMUM neurons in network ... ok
WASM Activation: Multiple MINIMUM neurons in network ... ok
WASM Activation: MAXIMUM and MINIMUM combined network ... ok

ok | 34 passed | 0 failed | 1 ignored
```

Full quality.sh run: **1536 tests passed**

## Test Plan

### New tests added (Issue #1120 - Phase 3)
- `WASM Activation: MAXIMUM batch activation` - Verifies MAXIMUM works correctly in batch mode
- `WASM Activation: MINIMUM batch activation` - Verifies MINIMUM works correctly in batch mode
- `WASM Activation: MAXIMUM with many inputs` - Tests MAXIMUM with 4 weighted inputs
- `WASM Activation: MINIMUM with many inputs` - Tests MINIMUM with 4 weighted inputs
- `WASM Activation: MAXIMUM with negative weights` - Tests MAXIMUM when weights flip input signs
- `WASM Activation: MINIMUM with negative weights` - Tests MINIMUM when weights flip input signs
- `WASM Activation: MAXIMUM with zero values` - Tests MAXIMUM edge cases with zero inputs
- `WASM Activation: MINIMUM with zero values` - Tests MINIMUM edge cases with zero inputs
- `WASM Activation: MAXIMUM in deep network` - Tests MAXIMUM in multi-layer network (ReLU -> MAXIMUM -> TANH)
- `WASM Activation: MINIMUM in deep network` - Tests MINIMUM in multi-layer network (ReLU -> MINIMUM -> TANH)
- `WASM Activation: Multiple MAXIMUM neurons in network` - Tests network with multiple MAXIMUM neurons
- `WASM Activation: Multiple MINIMUM neurons in network` - Tests network with multiple MINIMUM neurons
- `WASM Activation: MAXIMUM and MINIMUM combined network` - Tests network using both (computes absolute difference)

### Existing tests verified (from Phase 0 - Issue #1125)
- `WASM Activation: MINIMUM squash function` - Basic MINIMUM functionality
- `WASM Activation: MAXIMUM squash function` - Basic MAXIMUM functionality
- `WASM Activation: Mixed aggregate and standard squash functions` - Combined with ReLU
- `WASM Activation: Squash type mapping for aggregate functions` - Enum verification

## Acceptance Criteria Verification

- [x] MAXIMUM activation function works correctly in WASM
- [x] MINIMUM activation function works correctly in WASM
- [x] Creatures with MAXIMUM/MINIMUM neurons can use WASM activation
- [x] All 1536 existing tests pass without modification
- [x] New tests verify behaviour matches JS implementation

## Dependencies

- Issue #1119 (Phase 2: IF conditional logic) - Completed
- Issue #1125 (Phase 0: Binary format and basic implementation) - Completed

## Technical Notes

- MAXIMUM TypeScript implementation: `src/methods/activations/aggregate/MAXIMUM.ts`
- MINIMUM TypeScript implementation: `src/methods/activations/aggregate/MINIMUM.ts`
- WASM Rust implementation: `wasm_activation/src/lib.rs` (lines 322-352)
- SquashType enum: `src/wasm/SquashType.ts` (MINIMUM=32, MAXIMUM=33)
- Both convert to IDENTITY if only 1 inward connection via `fix()` method
