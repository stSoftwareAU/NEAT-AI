## Summary

Add `neat-core` from the external
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository as a
workspace dependency pinned to rev `36ac4ea3` (v0.1.1). `wasm_activation` stays
in-tree. Closes #2343.

### What changed

- **Root `Cargo.toml`** — new workspace with `wasm_activation` as a member and
  `neat-core` declared in `[workspace.dependencies]`. Release profile settings
  moved here (Cargo ignores per-member profiles in workspaces).
- **`wasm_activation/Cargo.toml`** — depends on `neat-core` via workspace;
  `wasm-bindgen` bumped from `=0.2.100` → `0.2.118` and `js-sys` from `=0.3.77`
  → `0.3.95` to resolve the version conflict with neat-core's target-gated
  wasm-bindgen requirement.
- **`.gitignore`** — added `target/` for the workspace-level Rust build artefact
  directory.
- **3 parity tests** — verify `SquashType` discriminant, `apply_squash`,
  `apply_derivative`, and `apply_calculate_error` produce identical results
  between neat-core and the in-tree wasm_activation implementations.
- **`docs/EXTERNAL_NEAT_AI_CORE.md`** — contributor guide covering dependency
  bumps, local path overrides, CI authentication, and cache key invalidation.

## Evidence

No UI changes. Backend/Rust workspace configuration verified by:

- `cargo build` — succeeds with no warnings
- `cargo test` — all 246 tests pass (including 3 new parity tests)
- `quality.sh --skip-tests --skip-discovery` — full lint, type-check, WASM
  build, and Rust test suite pass cleanly

## Test Plan

- `test_neat_core_dependency_resolves` — confirms neat-core resolves and
  `SquashType::Relu` discriminant matches the in-tree enum
- `test_neat_core_derivative_parity` — verifies `apply_derivative(Tanh, x)`
  produces identical output for four test inputs
- `test_neat_core_error_parity` — verifies `apply_calculate_error(Identity, …)`
  matches between neat-core and in-tree code
- All 243 pre-existing tests continue to pass unchanged
