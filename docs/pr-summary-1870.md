## Summary

Add targeted test cases exercising back propagation through chains of different
squash functions to identify corner cases where gradient flow degrades. Closes
#1870.

## Evidence

All 11 new tests pass via `./quality.sh` (4494 total tests, 0 failures).

Test cases cover:

1. **Bounded→Bounded**: TANH → LOGISTIC → BIPOLAR_SIGMOID
2. **Unbounded→Bounded**: ReLU → TANH → LOGISTIC
3. **Non-differentiable mixed**: STEP → ReLU → TANH
4. **Aggregate mixed (IF)**: IF → TANH → ReLU
5. **Aggregate mixed (MAXIMUM)**: MAXIMUM → LOGISTIC
6. **All saturating**: LOGISTIC → TANH → LOGISTIC with saturation-zone inputs
7. **Zero-derivative saturation**: GAUSSIAN → SELU
8. **Exploding derivative**: Exponential → TANH → LOGISTIC
9. **Gradient magnitude**: 5-layer TANH→LOGISTIC→BIPOLAR_SIGMOID→ReLU→SELU
   verifies all weights remain finite and at least some change
10. **Safe zone interaction**: mixed TANH/ReLU/LOGISTIC feeding single output
    with wide input range
11. **Saturated TANH → LOGISTIC boundary**: large biases pushing into saturation

Each convergence test perturbs a known-good network's weights/biases and asserts
that training reduces error, with retry logic for stochastic robustness.

## Test Plan

- Added `test/propagate/MixedSquashChains.ts` with 11 test cases
- All tests create small networks, run forward + backward passes, and assert
  convergence direction or gradient finiteness
- Tests use Australian English spelling
- All tests pass via `./quality.sh`
