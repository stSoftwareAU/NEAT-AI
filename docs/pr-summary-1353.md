## Summary

Updated the Rust edition for the `wasm_activation` crate from 2021 to 2024 (the latest stable edition, supported since Rust 1.85+).

### Changes made

1. **`Cargo.toml`**: Updated `edition = "2021"` to `edition = "2024"`.
2. **`src/loss.rs`**: Updated macro fragment specifiers from `expr` to `expr_2021` in the `batch_8way_activation!` macro. Rust 2024 changes the `expr` specifier to also match `const` and `_` expressions; using `expr_2021` preserves the existing behaviour.
3. **`src/error.rs`**: Added explicit `unsafe {}` blocks around `raw_error_lane()` calls inside the `apply_calculate_error_batch_4way` unsafe function. In Rust 2024, the body of an `unsafe fn` is a safe context by default (`unsafe_op_in_unsafe_fn` lint is warn-by-default), so all unsafe operations require explicit `unsafe {}` blocks.
4. **WASM package rebuilt**: The `pkg/` artefacts were regenerated with the updated crate.

### Dependencies

`wasm-bindgen` (0.2.108) and `js-sys` (0.3.85) were already at the latest versions and required no changes.

## Evidence

This is a backend/CLI change with no visual output. Evidence is provided via test results:

- **128 Rust unit tests** pass (`cargo test` - all pass, 0 failures)
- **WASM build** succeeds with zero warnings (`wasm-pack build --target web --release`)
- **2156 Deno tests** pass (`quality.sh` - all pass, 0 failures)
- WASM binary compiles cleanly for `wasm32-unknown-unknown` target with `-D unsafe_op_in_unsafe_fn` (deny level) and zero warnings

## Test Plan

- All existing 128 Rust unit tests verify correctness after the edition migration
- All existing 2156 Deno integration/unit tests verify the WASM module works correctly end-to-end
- No new tests needed as this is a toolchain edition upgrade with no behavioural changes
