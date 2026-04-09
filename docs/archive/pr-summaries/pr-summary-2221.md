## Summary

Add dedicated unit tests for 28 activation functions that previously lacked
individual test coverage. Each test file exercises the real activation function
with test data and verifies correctness of squash output, known values, output
range, edge cases, derivatives, and unSquash round-trips where applicable.
Closes #2221.

## Test Coverage Added

**Priority group** (7 files): ReLU, ReLU6, SELU, GELU, LOGISTIC, TANH, IDENTITY

**Second priority** (4 files): IF, Minimum, STEP, COMPLEMENT

**Remaining** (17 files): ABSOLUTE, ArcTan, BENT_IDENTITY, BIPOLAR,
BIPOLAR_SIGMOID, Cosine, Cube, Exponential, GAUSSIAN, HARD_TANH, ISRU,
LogSigmoid, SINE, SOFTSIGN, SQRT, SQUARE, StdInverse

Each test file verifies:

- Creature-level WASM activation matches the JS reference squash implementation
- Known input/output pairs against manually computed expected values
- Output stays within the function's declared range
- Edge cases (zero, large positive/negative values)
- Derivative correctness at known points
- unSquash(squash(x)) ≈ x round-trip (where implemented)

## Evidence

- All 5659 tests pass (0 failed, 3 ignored)
- `./quality.sh` passes cleanly (format, lint, type-check, tests)

## Test Plan

- 28 new test files in `test/methods/activations/`
- Each exercises the real activation function, not pattern-matching on source
- Edge cases (0, large values) tested for all activation functions
- Australian English used throughout
