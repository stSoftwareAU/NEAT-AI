## Summary

Build a native Rust CLI binary (`rust_scorer`) that scores a creature against a
training data directory, replicating the full scoring pipeline from the
TypeScript implementation. Closes #1967.

The scorer:

- Accepts CLI arguments for creature path, data directory, cost function,
  input/output dimensions, and growth cost
- Parses creature JSON and compiles to a `CompiledNetwork` via `neat-core`
- Iterates all training records, activates the network, and calculates loss
  using the specified cost function
- Computes complexity penalty (hidden neurons, synapses, weight/bias magnitude,
  squash complexity)
- Applies version penalty for non-v4 creatures
- Outputs JSON result to stdout with score, error, complexity penalty, record
  count, and network statistics

## Evidence

All 6 cost functions implemented (MSE, MAE, CrossEntropy, MAPE, MSLE, HINGE)
matching the TypeScript formulas exactly. The `valuePenalty` function matches
the recursive logarithmic compression from `Score.ts`. The scoring formula
`1 - error - complexityPenalty - versionPenalty` is identical to the TypeScript
implementation.

34 unit tests cover:

- `valuePenalty` edge cases (zero, small values, large values with compression,
  negative rejection)
- Complexity penalty formula verification
- Version penalty application
- Score component extraction from creatures
- All 6 cost functions with known expected values
- End-to-end scoring pipeline with identity networks, hidden neurons, multiple
  records
- Error handling: dimension mismatches, missing files, empty directories,
  invalid cost functions
- JSON output format verification with camelCase keys

Full quality gate passes: 4870 tests (including all existing tests), lint,
format, type-check.

## Test Plan

- `rust_scorer/src/scoring.rs` - 14 tests for valuePenalty, calculatePenalty,
  squash complexity, score calculation, and component extraction
- `rust_scorer/src/cost.rs` - 9 tests for cost function parsing and all 6 cost
  function calculations
- `rust_scorer/src/main.rs` - 11 integration tests for the full CLI pipeline
  including error cases
