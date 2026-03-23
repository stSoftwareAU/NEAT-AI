## Summary

Create an automated test suite that verifies the pure Rust CLI scorer produces
identical results to the TypeScript scoring pipeline for the same creature and
training data inputs. Closes #1968.

The test suite covers 21 test cases including:

- 6 cost functions (MSE, MAE, CrossEntropy, MAPE, MSLE, HINGE)
- 26 squash/activation functions (IDENTITY, ReLU, TANH, LOGISTIC, SELU, ELU,
  LeakyReLU, SOFTSIGN, Softplus, Swish, Mish, GELU, SINE, Cosine, ArcTan,
  GAUSSIAN, BENT_IDENTITY, BIPOLAR_SIGMOID, BIPOLAR, STEP, COMPLEMENT, ABSOLUTE,
  SQUARE, Cube, HARD_TANH, ReLU6)
- Network topologies: no hidden neurons, single hidden, multi-layer,
  multi-output, constant neurons, IF-type synapses (condition/positive/negative)
- Edge cases: large weights/biases, zero growth cost, version penalty, many
  records

All comparisons use a combined absolute (1e-8) and relative (1e-6) tolerance to
account for f32 vs f64 precision differences.

## Evidence

All 21 tests pass with TS and Rust scorers producing matching scores:

- 4891 total tests pass (4890 existing + 1 new test file with 21 sub-tests)
- The one pre-existing intermittent failure (`TraceNeuron.ts`) is unrelated to
  this change and passes when run in isolation

## Test Plan

- Added `test/score/TsRustScorerConsistency.ts` with 21 test cases that:
  1. Build creature JSON fixtures programmatically
  2. Write binary training data to temp directories
  3. Score using TS pipeline (`Creature.fromJSON()` -> `activate()` -> cost ->
     `Score.calculate()`)
  4. Score using Rust CLI scorer binary via `Deno.Command`
  5. Compare error and score values within tolerance
  6. Clean up temp files after each test
