## Summary

Add the `Cargo Quality` GitHub Actions workflow requested in issue #2360. The
workflow runs `cargo fmt --all --check` and
`cargo clippy --workspace -- -D warnings` on every pull request targeting
`Develop`, matching the repository convention used by the other Rust and Deno
workflows (`quality.yml`, `wasm-build.yml`, `coverage.yaml`, `spellcheck.yaml`,
`codeql.yml`).

To make the gate pass on the existing workspace, two supporting changes were
made:

1. **`cargo fmt` applied to `wasm_activation/src/*.rs`** – pure whitespace
   changes produced by rustfmt. No logic change. All 246 Rust unit tests still
   pass.
2. **`[lints.clippy]` added to `wasm_activation/Cargo.toml`** – explicitly
   allows the eight clippy lints (`too_many_arguments`, `needless_range_loop`,
   `manual_memcpy`, `same_item_push`, `neg_multiply`, `needless_late_init`,
   `missing_const_for_thread_local`, `doc_nested_refdefs`) that currently fire
   across the existing wasm_activation code. Introducing the CI gate is
   intentionally decoupled from a full clippy clean-up – the workflow will still
   catch any **new** occurrence of any other clippy lint in future PRs, and
   these allows can be removed one lint at a time as the existing code is
   refactored.

Closes #2360.

## Evidence

Backend/CI change – no UI to screenshot. Verified locally:

```
$ cargo fmt --all --check
# exit 0

$ cargo clippy --workspace -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s
# exit 0

$ cargo test --workspace
test result: ok. 246 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ ./quality.sh --lint-only
[1/4] Updating dependencies... All dependencies are up to date.
[2/4] Formatting code...       Checked 1960 files
[3/4] Linting...               Checked 1397 files
[4/4] Checking bash scripts... all ✅
```

The new workflow file was also parsed with a YAML parser to confirm it is
well-formed.

## Test Plan

- [x] `cargo fmt --all --check` passes (was failing before the rustfmt pass).
- [x] `cargo clippy --workspace -- -D warnings` passes (was reporting 57 errors
      across 8 lints before the `[lints.clippy]` exemptions).
- [x] `cargo test --workspace` – all 246 existing Rust tests still pass after
      the formatting changes.
- [x] `./quality.sh --lint-only` passes cleanly (Deno fmt, lint, bash check).
- [x] `.github/workflows/cargo-quality.yml` parses as valid YAML.
- [x] Workflow triggers on `pull_request` to `Develop` (matches the repository
      convention) and on manual `workflow_dispatch`.
