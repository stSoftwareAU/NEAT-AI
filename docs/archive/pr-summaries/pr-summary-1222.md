## Summary

Fixes #1222: Refactor `wasm_activation/src/lib.rs` which was far too large (not
maintainable).

This PR refactors the monolithic 5817-line `lib.rs` file into 10 smaller,
focused modules following Rust best practices for code organisation and
maintainability.

### Problem

The `wasm_activation/src/lib.rs` file had grown to 5817 lines, containing all
activation functions, network structures, SIMD implementations, loss functions,
and tests in a single file. This made the codebase difficult to navigate,
maintain, and extend.

### Solution

Extracted the monolithic `lib.rs` into the following modules:

| Module            | Responsibility                                                | Lines |
| ----------------- | ------------------------------------------------------------- | ----- |
| `squash.rs`       | SquashType enum, apply_squash functions, activation constants | ~300  |
| `derivative.rs`   | apply_derivative function for backpropagation                 | ~350  |
| `unsquash.rs`     | apply_unsquash (inverse activation) function                  | ~650  |
| `safe_zone.rs`    | apply_safe_zone_adjustment for gradient flow                  | ~900  |
| `error.rs`        | calculate_error and clamp_error functions                     | ~400  |
| `range.rs`        | get_range, validate_range, limit_range functions              | ~350  |
| `simd.rs`         | SIMD-optimised weighted_sum functions                         | ~300  |
| `network.rs`      | CompiledNetwork struct and activation methods                 | ~720  |
| `synapse_type.rs` | SynapseType enum for IF activation                            | ~40   |
| `loss.rs`         | MSE, MAE, cross-entropy, MAPE, MSLE, Hinge batch functions    | ~1750 |
| `lib.rs`          | Module declarations, re-exports, standalone functions, tests  | ~600  |

### Changes

- **Module extraction**: Split monolithic lib.rs into 10 focused modules
- **Clean API**: Public types and functions re-exported from lib.rs for backward
  compatibility
- **Preserved functionality**: All 80 tests continue to pass
- **Code quality**: Fixed clippy warnings (manual_clamp, needless_range_loop,
  collapsible_if, etc.)
- **Performance**: Runtime performance unchanged - same SIMD optimisations, same
  inlined functions

### Module Dependencies

```
lib.rs
  ├── squash.rs (SquashType, apply_squash, constants)
  │     └── Used by all other modules
  ├── synapse_type.rs (SynapseType)
  │     └── Used by network.rs, loss.rs
  ├── derivative.rs
  │     └── Uses squash.rs constants
  ├── unsquash.rs
  │     └── Uses derivative.rs, squash.rs
  ├── safe_zone.rs
  │     └── Uses derivative.rs, squash.rs
  ├── error.rs
  │     └── Uses derivative.rs, unsquash.rs, squash.rs
  ├── range.rs
  │     └── Uses squash.rs constants
  ├── simd.rs
  │     └── Uses network.rs (SynapseData)
  ├── network.rs
  │     └── Uses squash.rs, synapse_type.rs, range.rs, simd.rs
  └── loss.rs
        └── Uses network.rs, squash.rs, synapse_type.rs, range.rs, simd.rs
```

## Evidence

Unable to generate screenshot: This is a CLI-only Rust/WASM library with no
visual interface.

Before:

```
wasm_activation/src/
├── lib.rs (5817 lines)
```

After:

```
wasm_activation/src/
├── lib.rs (~600 lines)
├── squash.rs
├── derivative.rs
├── unsquash.rs
├── safe_zone.rs
├── error.rs
├── range.rs
├── simd.rs
├── network.rs
├── synapse_type.rs
└── loss.rs
```

## Test Plan

All existing tests continue to pass:

```
running 80 tests
test derivative::tests::test_derivative_* ... ok (13 tests)
test error::tests::test_calculate_error_* ... ok (6 tests)
test range::tests::test_*_range_* ... ok (7 tests)
test squash::tests::test_* ... ok (3 tests)
test unsquash::tests::test_unsquash_* ... ok (10 tests)
test tests::test_* ... ok (41 tests)

test result: ok. 80 passed; 0 failed; 0 ignored
```

Quality checks pass:

- `cargo fmt --check` - no formatting issues
- `cargo clippy -- -D warnings` - no warnings
- `cargo test` - all 80 tests pass

The refactoring is purely structural with no functional changes - the WASM
module's public API remains identical, ensuring full backward compatibility.
