## Summary

This PR completes WASM Migration Phase 2: Implement IF conditional logic in
WASM.

**Key Finding:** The IF WASM implementation was already completed in Issue #1125
(Phase 0). This PR adds comprehensive verification tests to ensure the WASM and
JS implementations produce identical results.

### Implementation Status (from Phase 0 and Phase 1)

The following requirements from Issue #1119 were already implemented:

1. **Binary format includes synapse types** ✅
   - `CompileToWasm.ts` encodes synapse types (condition=1, positive=3,
     negative=2, standard=0)
   - Each synapse uses 8 bytes including 1 byte for type

2. **IF logic implemented in WASM (Rust)** ✅
   - `wasm_activation/src/lib.rs` lines 354-376 implement IF activation
   - Correctly handles condition, positive, negative sums
   - Applies conditional:
     `if condition_sum > 0 { positive_sum + bias } else { negative_sum + bias }`
   - Batch activation also supports IF (lines 480-496)

3. **WASM eligibility detection updated** ✅
   - IF is included in `SQUASH_NAME_TO_TYPE` mapping (`SquashType.ts`)
   - Creatures with IF neurons are WASM-eligible

### What This PR Adds

New tests in `test/WasmActivation.ts` verifying IF WASM behaviour:

| Test Name                                     | Purpose                                                        |
| --------------------------------------------- | -------------------------------------------------------------- |
| IF with multiple positive and negative inputs | Verifies multiple inputs within each type are summed correctly |
| IF with standard type synapses                | Verifies standard (untyped) synapses are treated as positive   |
| IF batch activation                           | Verifies batch mode works correctly with IF neurons            |
| IF with weighted condition inputs             | Verifies condition weights affect the threshold correctly      |
| IF in complex network with other neurons      | Verifies IF works alongside other squash functions             |

## Evidence

This is a functionality enhancement with no UI changes. The implementation was
verified through:

- All 1523 tests pass (including 5 new IF-specific tests)
- WASM and JS implementations produce identical outputs for all test cases

### Test Execution Results

```
WASM Activation: IF squash function ... ok
WASM Activation: IF with multiple condition inputs ... ok
WASM Activation: IF with multiple positive and negative inputs ... ok
WASM Activation: IF with standard type synapses (treated as positive) ... ok
WASM Activation: IF batch activation ... ok
WASM Activation: IF with weighted condition inputs ... ok
WASM Activation: IF in complex network with other neurons ... ok

ok | 1523 passed | 0 failed
```

## Test Plan

The following tests verify IF behaviour matches JS implementation:

### Existing Tests (from Phase 0)

- `test/WasmActivation.ts`:
  - "WASM Activation: IF squash function" - Basic IF with
    condition/positive/negative branches
  - "WASM Activation: IF with multiple condition inputs" - Multiple condition
    synapses summed
  - "WASM Activation: Mixed aggregate and standard squash functions" - IF with
    other squash types

- `test/CreatureWasmActivation.ts`:
  - "Creature WASM: isWasmEligible() supports aggregate functions (IF, MINIMUM,
    MAXIMUM)" - Eligibility detection
  - "Creature WASM: All supported squash functions produce correct results" - IF
    included in comprehensive test

### New Tests Added (This PR)

- "WASM Activation: IF with multiple positive and negative inputs"
- "WASM Activation: IF with standard type synapses (treated as positive)"
- "WASM Activation: IF batch activation"
- "WASM Activation: IF with weighted condition inputs"
- "WASM Activation: IF in complex network with other neurons"

## Acceptance Criteria Verification

- [x] IF activation function works correctly in WASM
- [x] Binary format includes synapse type information
- [x] Creatures with IF neurons can use WASM activation
- [x] All 1400+ existing tests pass without modification (1523 tests pass)
- [x] New tests verify IF behaviour matches JS implementation (5 new tests
      added)

## Technical Notes

### Synapse Type Encoding

```typescript
// TypeScript (CompileToWasm.ts)
enum SynapseTypeCode {
  Standard = 0, // Also used as "positive" for IF
  Condition = 1, // Determines which branch to take
  Negative = 2, // Used when condition <= 0
  Positive = 3, // Explicitly positive branch
}
```

```rust
// Rust (lib.rs)
pub enum SynapseType {
    Standard = 0,
    Condition = 1,
    Negative = 2,
    Positive = 3,
}
```

### IF Logic in Rust

```rust
SquashType::If => {
    let mut condition_sum = 0.0f32;
    let mut positive_sum = 0.0f32;
    let mut negative_sum = 0.0f32;

    for synapse in synapses {
        let val = activations[from_idx] * weight;
        match SynapseType::from(syn_type) {
            SynapseType::Condition => condition_sum += val,
            SynapseType::Negative => negative_sum += val,
            SynapseType::Positive | SynapseType::Standard => positive_sum += val,
        }
    }

    if condition_sum > 0.0 {
        positive_sum + bias
    } else {
        negative_sum + bias
    }
}
```

## Dependencies

- Issue #1118 (Phase 1: WASM integration in Creature class) ✅ Completed
- Issue #1125 (Phase 0: Aggregate functions) ✅ Completed (implemented IF)
- Issue #1116 (Prototype WASM) ✅ Completed
