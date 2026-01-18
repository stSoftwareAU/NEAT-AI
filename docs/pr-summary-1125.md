## Summary

Implemented missing aggregate squash functions (IF, MINIMUM, MAXIMUM) in the
Rust/WASM activation module to complete Phase 0 of the WASM migration (Issue
#1125).

### Changes Made

1. **TypeScript SquashType enum** (`src/wasm/SquashType.ts`):
   - Added `Minimum = 32`, `Maximum = 33`, `If = 34` to the enum
   - Added corresponding mappings in `SQUASH_NAME_TO_TYPE`

2. **Rust WASM module** (`wasm_activation/src/lib.rs`):
   - Added `Minimum`, `Maximum`, `If` variants to `SquashType` enum
   - Added `SynapseType` enum for IF's conditional logic (Standard, Condition,
     Negative, Positive)
   - Updated `CompiledNetwork` to store synapse types (changed from 6 bytes to 8
     bytes per synapse)
   - Implemented aggregate function logic in `activate()` and
     `activate_batch()`:
     - **MINIMUM**: Returns min(weighted_inputs) + bias
     - **MAXIMUM**: Returns max(weighted_inputs) + bias
     - **IF**: Evaluates condition synapses; if sum > 0, uses positive branch,
       else uses negative branch

3. **CompileToWasm** (`src/wasm/CompileToWasm.ts`):
   - Updated binary format to include synapse types (8 bytes per synapse instead
     of 6)
   - Added `SynapseTypeCode` enum and `getSynapseTypeCode()` function

4. **Tests** (`test/WasmActivation.ts`):
   - Added tests for MINIMUM squash function
   - Added tests for MAXIMUM squash function
   - Added tests for IF squash function (single and multiple conditions)
   - Added tests for mixed aggregate and standard squash functions
   - Added test for aggregate function squash type mapping
   - Updated ignored test comment to reflect that only deprecated functions
     (HYPOT, MEAN) remain unsupported

### Why This Matters

Production creatures use IF, MINIMUM, and MAXIMUM functions extensively. Without
WASM support for these functions, the system would always fall back to
JavaScript execution, negating the performance benefits of the WASM migration.

MEAN and HYPOT are deprecated (mutationProbability = 0) and were intentionally
not implemented. Production creatures should have evolved away from using them.

## Evidence

This is a performance/internal implementation change with no visual interface.
The evidence is the passing test suite.

### Test Results

All 17 WASM activation tests pass, including 6 new tests for aggregate
functions:

```
WASM Activation: MINIMUM squash function ... ok
WASM Activation: MAXIMUM squash function ... ok
WASM Activation: IF squash function ... ok
WASM Activation: IF with multiple condition inputs ... ok
WASM Activation: Mixed aggregate and standard squash functions ... ok
WASM Activation: Squash type mapping for aggregate functions ... ok
```

The full quality.sh suite passes with 1477 tests.

## Test Plan

- Added `WASM Activation: MINIMUM squash function` - Tests MINIMUM with various
  inputs
- Added `WASM Activation: MAXIMUM squash function` - Tests MAXIMUM with various
  inputs
- Added `WASM Activation: IF squash function` - Tests IF with
  condition/positive/negative branches
- Added `WASM Activation: IF with multiple condition inputs` - Tests IF with
  multiple condition synapses
- Added `WASM Activation: Mixed aggregate and standard squash functions` - Tests
  creatures using both types
- Added `WASM Activation: Squash type mapping for aggregate functions` -
  Verifies enum mappings
