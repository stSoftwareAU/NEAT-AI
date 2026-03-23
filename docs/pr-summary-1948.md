## Summary

Extend parallel bridge neuron merging to support COMPLEMENT squash functions
in addition to IDENTITY. Closes #1948.

COMPLEMENT (`f(x) = 1 - x`) is an affine function that can be algebraically
converted to IDENTITY: `1 - (w*x + b) = (-w)*x + (1 - b)`. After conversion,
standard IDENTITY merging applies. All other non-linear squash functions
(LOGISTIC, TANH, ReLU, ABSOLUTE, etc.) do not satisfy the additivity property
`f(a+b) = f(a) + f(b)` required for safe parallel merging, so they are
explicitly excluded.

### Changes

- **`src/methods/activations/SquashUtils.ts`**: Added `isParallelMergeableSquash()`
  utility with comprehensive analysis documenting which squash functions support
  parallel merging and why.
- **`src/compact/ParallelBridgeMerge.ts`** (new): Generalised parallel bridge
  merge that handles both IDENTITY and COMPLEMENT neurons. COMPLEMENT neurons
  are converted to IDENTITY in-place before merging.
- **`src/compact/CompactCreature.ts`**: Integrated the new `mergeParallelBridges()`
  into the compaction pipeline after the existing IDENTITY-only pass.
- **`test/compact/ParallelBridgeMerge.ts`** (new): 11 tests covering COMPLEMENT
  merging, weight/bias calculation, mixed squash rejection, and explicit
  non-mergeability tests for LOGISTIC, TANH, ReLU, ABSOLUTE, and MAXIMUM.

## Evidence

All 4870 tests pass with no regressions. The new test file adds 11 targeted
tests exercising the extended merging logic.

## Test Plan

- `parallel bridge merge: two COMPLEMENT bridge neurons are merged`
- `parallel bridge merge: COMPLEMENT weight calculation is correct`
- `parallel bridge merge: mixed IDENTITY and COMPLEMENT are NOT merged together`
- `parallel bridge merge: LOGISTIC neurons are not merged`
- `parallel bridge merge: TANH neurons are not merged`
- `parallel bridge merge: ReLU neurons are not merged`
- `parallel bridge merge: ABSOLUTE neurons are not merged`
- `parallel bridge merge: MAXIMUM aggregate neurons are not merged`
- `parallel bridge merge: COMPLEMENT merge preserves structure via compactCreature`
- `parallel bridge merge: three COMPLEMENT neurons merged correctly`
- `parallel bridge merge: IDENTITY neurons still work as before`
