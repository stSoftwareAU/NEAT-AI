# NEAT-AI-core Parity Audit (Issue #2367)

This audit verifies that every public item and test in the in-tree `neat-core/`
crate (as it exists on the `milestone/pure-rust-scorer-experiment` branch of
this repository) has a corresponding equivalent in the external
[stSoftwareAU/NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) crate
at the pinned revision.

This is the parity precondition for **Issue #2346** (remove in-tree native Rust
duplicated by NEAT-AI-core). It is a required step in the parent epic **Issue
#2366**.

## Pinned revision

The audit compares against the `neat-core` tree at the revision pinned in the
root `Cargo.toml`:

```toml
neat-core = { git = "https://github.com/stSoftwareAU/NEAT-AI-core.git",
              rev = "36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959" }
```

- Pinned rev: `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959` (NEAT-AI-core commit
  "Add training_bin_stream module for efficient binary data reading (#1)").
- In-tree source of truth for this audit: branch
  `milestone/pure-rust-scorer-experiment`, path `neat-core/src/*.rs` (the
  `Develop` branch no longer carries `neat-core/`).

## Methodology

For every `*.rs` file under `neat-core/src/`:

1. Enumerate every `pub fn`, `pub struct`, `pub enum`, `pub type`, `pub const`,
   `pub static`, `pub trait` and every top-level `impl` block.
2. Enumerate every `#[test]` function (inline `#[cfg(test)] mod tests`).
3. Compare against the same file in NEAT-AI-core at the pinned rev.
4. For tests that have been moved out of inline `mod tests` into NEAT-AI-core's
   `neat-core/tests/*.rs` integration tests, match by test-function name across
   **all** NEAT-AI-core test files (inline plus integration).

Item names are compared as exact strings (e.g. `pub fn foo`, `pub struct Bar`).
A pub item is considered "present" in NEAT-AI-core if a lexically identical pub
declaration exists in any `neat-core/src/*.rs` file at the pinned rev. A test is
considered "present" if a `#[test] fn <same_name>` exists anywhere in
NEAT-AI-core's `neat-core/src` or `neat-core/tests`.

The full raw scan output is reproducible on demand via
`./scripts/neat-core-parity-audit.sh --json`.

## Parity matrix

Counts are per file; "Missing pub" and "Missing tests" list any item that exists
in-tree but is absent from NEAT-AI-core at the pinned rev.

| File                      | In-tree pub | Ext pub | Missing pub | In-tree impl | Ext impl | Missing impl | In-tree tests | Ext inline tests | Missing tests |
| ------------------------- | ----------- | ------- | ----------- | ------------ | -------- | ------------ | ------------- | ---------------- | ------------- |
| `accumulate.rs`           | 10          | 10      | —           | 0            | 0        | —            | 20            | 12               | —             |
| `creature.rs`             | 7           | 7       | —           | 0            | 0        | —            | 23            | 0                | —             |
| `derivative.rs`           | 3           | 3       | —           | 0            | 0        | —            | 27            | 0                | —             |
| `elastic_distribution.rs` | 2           | 2       | —           | 0            | 0        | —            | 15            | 0                | —             |
| `error.rs`                | 6           | 6       | —           | 0            | 0        | —            | 14            | 0                | —             |
| `fused_error.rs`          | 1           | 1       | —           | 0            | 0        | —            | 4             | 0                | —             |
| `lib.rs`                  | 0           | 0       | —           | 0            | 0        | —            | 12            | 0                | —             |
| `loss.rs`                 | 6           | 6       | —           | 0            | 0        | —            | 0             | 0                | —             |
| `network.rs`              | 12          | 12      | —           | 2            | 2        | —            | 7             | 0                | —             |
| `pc_inference.rs`         | 15          | 15      | —           | 2            | 2        | —            | 14            | 0                | —             |
| `pc_learning.rs`          | 3           | 3       | —           | 2            | 2        | —            | 5             | 0                | —             |
| `range.rs`                | 10          | 10      | —           | 0            | 0        | —            | 7             | 0                | —             |
| `safe_zone.rs`            | 2           | 2       | —           | 0            | 0        | —            | 0             | 0                | —             |
| `score_scan.rs`           | 4           | 4       | —           | 0            | 0        | —            | 8             | 0                | —             |
| `simd.rs`                 | 12          | 12      | —           | 0            | 0        | —            | 20            | 0                | —             |
| `squash.rs`               | 13          | 13      | —           | 1            | 1        | —            | 9             | 0                | —             |
| `synapse_type.rs`         | 1           | 1       | —           | 1            | 1        | —            | 0             | 0                | —             |
| `training_data.rs`        | 17          | 17      | —           | 6            | 6        | —            | 29            | 29               | —             |
| `training_state.rs`       | 13          | 13      | —           | 0            | 0        | —            | 9             | 9                | —             |
| `unsquash.rs`             | 1           | 1       | —           | 0            | 0        | —            | 10            | 0                | —             |

**Totals:** 136 pub items, 14 top-level `impl` blocks, and 232 `#[test]`
functions audited in-tree. **Zero missing pub items, zero missing `impl` blocks,
zero missing tests in NEAT-AI-core at the pinned rev.**

## Where the inline tests live upstream

NEAT-AI-core has moved most of the in-tree inline `#[cfg(test)] mod tests` into
`neat-core/tests/*.rs` integration tests. For each in-tree file, the table below
records the NEAT-AI-core location(s) that carry the same `#[test]` functions
(matched by function name).

| In-tree file              | NEAT-AI-core test location(s)                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `accumulate.rs`           | `src/accumulate.rs` (12 inline) + `tests/accumulate_public.rs` (8)                       |
| `creature.rs`             | `tests/creature_compile.rs` (23)                                                         |
| `derivative.rs`           | `tests/derivative.rs` (27) + `tests/integration.rs` (derivative-related)                 |
| `elastic_distribution.rs` | `tests/elastic_distribution.rs` (15)                                                     |
| `error.rs`                | `tests/error_calculate.rs` (14)                                                          |
| `fused_error.rs`          | `tests/fused_error.rs` (4)                                                               |
| `lib.rs`                  | `tests/integration.rs` + `tests/squash.rs` + `tests/unsquash.rs` + `tests/derivative.rs` |
| `loss.rs`                 | No inline tests on either side                                                           |
| `network.rs`              | `tests/network_activate_trace_batch.rs` (7)                                              |
| `pc_inference.rs`         | `tests/pc_inference.rs` (14)                                                             |
| `pc_learning.rs`          | `tests/pc_learning.rs` (5)                                                               |
| `range.rs`                | `tests/range.rs` (7)                                                                     |
| `safe_zone.rs`            | No inline tests on either side                                                           |
| `score_scan.rs`           | `tests/score_scan.rs` (8)                                                                |
| `simd.rs`                 | `tests/simd_weighted_sums.rs` (20)                                                       |
| `squash.rs`               | `tests/squash.rs` (9) + `tests/integration.rs`                                           |
| `synapse_type.rs`         | No tests on either side (covered via `creature_compile.rs`)                              |
| `training_data.rs`        | Inline (29) — unchanged location                                                         |
| `training_state.rs`       | Inline (9) — unchanged location                                                          |
| `unsquash.rs`             | `tests/unsquash.rs` (10) + `tests/integration.rs`                                        |

## Items where NEAT-AI-core is ahead

- **`neat-core/src/training_bin_stream.rs`** exists in NEAT-AI-core but not in
  the in-tree `neat-core/`. Added in NEAT-AI-core PR #1 (the pinned rev). No
  in-tree equivalent needs to be removed; this is additive upstream.
- NEAT-AI-core has reorganised inline tests into integration tests
  (`neat-core/tests/*.rs`), which is a structural improvement over the in-tree
  arrangement. All functions are preserved.

## Upstream issues raised

**None.** No public API or `#[test]` function is missing from NEAT-AI-core at
rev `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959`. All 136 pub items, 14 `impl`
blocks, and 232 test functions are present (inline or integration). No upstream
issues need to be filed.

## Pinned rev sign-off

- Pinned rev in `Cargo.toml`: `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959` —
  **unchanged, no bump required**. This revision already covers every in-tree
  item audited.
- Parity gate (Issue #2345, `./scripts/parity-gate.sh`) remains the running
  contract for future bumps.
- **Result:** the precondition on Issue #2346 is satisfied. In-tree native Rust
  (excluding `wasm_activation/`) can be removed.

## Reproducing this audit

Run the committed audit script — it reads the pinned rev from `Cargo.toml`,
extracts the in-tree `neat-core/` from the
`milestone/pure-rust-scorer-experiment` branch, clones NEAT-AI-core at the
pinned rev, and fails with a non-zero exit if any pub item or test from the
in-tree crate is missing upstream:

```bash
./scripts/neat-core-parity-audit.sh
./scripts/neat-core-parity-audit.sh --json  # raw scan data
```

The script requires network access to clone NEAT-AI-core, which is why it is not
wired into `quality.sh` by default. Run it when bumping the pinned `rev` or
before removing any in-tree Rust (Issue #2346).
