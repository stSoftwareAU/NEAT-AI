# rust_scorer Parity Audit (Issue #2368)

Audit of the in-tree `rust_scorer/` crate against the
[NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer) `rust_scorer/`
crate. Companion to #2366 (check everything has been migrated to
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core)).

## Executive summary

- **In-tree `rust_scorer/` is not on `Develop`.** It lives only on the
  `milestone/pure-rust-scorer-experiment` branch, added by commit `d414dac5` (PR
  #1982, Issue #1967) and never merged. `grep -r rust_scorer src/` on `Develop`
  returns no TypeScript callers — nothing spawns the binary today.
- **NEAT-AI-scorer is the upstream source of truth.** All shared scoring logic
  is present either in NEAT-AI-scorer's
  `rust_scorer/src/{cost.rs, main.rs,
  scoring.rs, stream_score.rs, bin/float_scan_bench.rs}`
  or in
  `neat_core::{loss, creature, training_bin_stream, training_data, network,
  squash}`
  (via the pinned `rev` in this repo's `Cargo.toml`).
- **Deliberate scope reduction upstream:** NEAT-AI-scorer is explicitly marketed
  as an "MSE scorer" (README line 1) and accepts only two positional arguments
  (`creature` and `data`). The experimental
  `--cost / --inputs / --outputs /
  --growth-cost` CLI flags were dropped in
  favour of reading those values from the creature JSON and a compile-time
  `GROWTH_COST = 1e-7`.
- **No runtime parity risk** because no caller in NEAT-AI spawns `rust_scorer`.
  Should a caller be added, NEAT-AI-scorer's positional contract must be used.
- **One upstream issue raised** to track the cost-function CLI narrowing
  decision so it is documented rather than implicit — see "Upstream issues"
  below.

## 1. Provenance of the in-tree crate

| Fact                        | Value                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| Branch where present        | `milestone/pure-rust-scorer-experiment` only                                    |
| Absent from                 | `Develop` (current production branch)                                           |
| Introduced by               | Commit `d414dac5` (PR #1982, Issue #1967)                                       |
| Spawned from TypeScript?    | **No** — zero references in `src/**` (`grep -r rust_scorer src` is empty).      |
| Tracking issue (experiment) | #1963 (closed) — "What would it take to create a pure Rust scorer application?" |
| Benchmark tracking issue    | #1969 (open) — production-scale comparison                                      |

## 2. File-by-file parity matrix

### 2.1 `cost.rs`

| In-tree item                                                        | Kind     | Upstream location                                                                                                                                                                                | Notes                                                                         |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `pub enum CostFunction {Mse, Mae, CrossEntropy, Mape, Msle, Hinge}` | enum     | Not in scorer. Equivalents in `neat_core::loss::*_sum_batch_packed`.                                                                                                                             | Scorer is MSE-only by design.                                                 |
| `CostFunction::from_name`                                           | `pub fn` | Not in scorer.                                                                                                                                                                                   | Obsolete without `--cost`.                                                    |
| `calculate_cost(cost, target, output)`                              | `pub fn` | MSE branch → `cost::mse_mean_record` in scorer; all six branches → `neat_core::loss::{mse,mae,cross_entropy,mape,msle,hinge}_sum_batch_packed` (batch-fused variants, packed over full dataset). | Per-record dispatch for non-MSE functions is not exposed at scorer CLI level. |

**Upstream `cost.rs` surface:**

| Upstream item                                   | In-tree equivalent                                   |
| ----------------------------------------------- | ---------------------------------------------------- |
| `pub fn mse_mean_record(target, output) -> f64` | The `CostFunction::Mse` arm inside `calculate_cost`. |

**Cost function coverage resolution:**

- The other five cost functions **are** reachable in `neat-core` via the fused
  batch variants (`mae_sum_batch_packed`, `cross_entropy_sum_batch_packed`,
  `mape_sum_batch_packed`, `msle_sum_batch_packed`, `hinge_sum_batch_packed` —
  see
  [`NEAT-AI-core/neat-core/src/loss.rs`](https://github.com/stSoftwareAU/NEAT-AI-core/blob/main/neat-core/src/loss.rs)
  lines 1722–2024).
- However, **NEAT-AI-scorer's CLI does not dispatch on cost**. It is locked to
  MSE. This is a deliberate narrowing (README: "Native MSE scorer CLI"), not an
  oversight. Upstream issue filed to document this decision: see "Upstream
  issues" below.

### 2.2 `main.rs` — CLI surface

| In-tree flag                             | Upstream equivalent                                   | Status                            |
| ---------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| `--creature <path>`                      | Positional `<creature.json>`                          | Same semantics, different syntax. |
| `--data <path>`                          | Positional `<training_data_dir>`                      | Same semantics, different syntax. |
| `--cost <name>`                          | **Removed upstream** (MSE only).                      | Deliberate scope cut.             |
| `--inputs <usize>`                       | **Removed upstream** — read from `creature.input`.    | Deliberate scope cut.             |
| `--outputs <usize>`                      | **Removed upstream** — read from `creature.output`.   | Deliberate scope cut.             |
| `--growth-cost <f64>` (default `0.0001`) | **Removed upstream** — constant `GROWTH_COST = 1e-7`. | Deliberate scope cut.             |

**Additional upstream behaviour absent from in-tree:**

- Reads `forward_only` from creature JSON and switches between the fused
  streaming path (`stream_score::accumulate_mse_sum_forward_only_fused`) and the
  per-record iterator path (`TrainingDataIterator`).
- Emits extra telemetry fields in `ScoreResult`: `forwardOnly`,
  `trainingReadBackend`, `readBufLen`, `activationThreads`,
  `parallelActivationBatches`, `maxActivationBatchRecords`, `timeTaken`.

**Exit codes:**

| Condition                       | In-tree                                   | Upstream                       |
| ------------------------------- | ----------------------------------------- | ------------------------------ |
| Success                         | `0` with pretty-JSON on stdout            | `0` with pretty-JSON on stdout |
| Any error (`run` returns `Err`) | `eprintln!("Error: …"); process::exit(1)` | Same                           |

Exit-code contract is identical.

### 2.3 `scoring.rs`

| In-tree item                                | Kind   | Upstream status                                |
| ------------------------------------------- | ------ | ---------------------------------------------- |
| `pub const SEMANTIC_MAJOR_VERSION: u32 = 4` | const  | ✅ Identical                                   |
| `pub fn value_penalty`                      | fn     | ✅ Identical                                   |
| `fn calculate_penalty`                      | fn     | ✅ Identical                                   |
| `fn squash_complexity_penalty`              | fn     | ✅ Identical                                   |
| `pub struct ScoreComponents`                | struct | ✅ Identical                                   |
| `pub fn compute_score_components`           | fn     | ✅ Identical                                   |
| `pub fn calculate_score`                    | fn     | ✅ Identical                                   |
| `pub struct ScoreResult`                    | struct | ✅ Superset upstream (extra telemetry fields). |

### 2.4 `stream_score.rs` (upstream-only)

No in-tree equivalent. Provides:

| Upstream item                                  | Purpose                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pub fn activation_worker_count_for_scorer`    | Reads `NEAT_SCORER_ACTIVATION_THREADS` (clamp 1..=64).                                                          |
| `pub fn effective_fused_read_buf_len`          | Rounds fused I/O buffer to a whole-record multiple.                                                             |
| `pub fn accumulate_mse_sum_forward_only_fused` | Forward-only fused MSE scan over `.bin` files using `for_each_read_chunk_with_mode` and `mse_sum_batch_packed`. |

### 2.5 `bin/float_scan_bench.rs` (upstream-only)

Companion binary for throughput experiments using the same `training_bin_stream`
reader. No equivalent in the in-tree experiment.

## 3. Test parity

### 3.1 `cost.rs` tests

| In-tree test                     | Upstream location                                                           |
| -------------------------------- | --------------------------------------------------------------------------- |
| `test_cost_function_parsing`     | Obsolete upstream (no `CostFunction::from_name`).                           |
| `test_mse_perfect_prediction`    | ✅ Present in `cost.rs`.                                                    |
| `test_mse_known_value`           | ✅ Present in `cost.rs`.                                                    |
| `test_mae_known_value`           | Covered by `neat_core::loss` tests (upstream scorer does not dispatch MAE). |
| `test_cross_entropy_known_value` | Covered by `neat_core::loss` tests.                                         |
| `test_hinge_correct_prediction`  | Covered by `neat_core::loss` tests.                                         |
| `test_hinge_wrong_prediction`    | Covered by `neat_core::loss` tests.                                         |
| `test_mape_known_value`          | Covered by `neat_core::loss` tests.                                         |
| `test_msle_perfect_prediction`   | Covered by `neat_core::loss` tests.                                         |

### 3.2 `scoring.rs` tests

All 14 tests exist upstream verbatim:
`test_value_penalty_zero_for_small_values`,
`test_value_penalty_increases_with_magnitude`,
`test_value_penalty_never_reaches_one`, `test_value_penalty_known_values`,
`test_value_penalty_compression`, `test_value_penalty_rejects_negative`,
`test_calculate_penalty_symmetric`, `test_calculate_penalty_zero_for_small`,
`test_squash_complexity_if_has_penalty`, `test_squash_complexity_standard_zero`,
`test_calculate_score_perfect`, `test_calculate_score_with_error`,
`test_version_penalty_applied`, `test_complexity_penalty_formula`,
`test_score_components_from_creature`.

### 3.3 `main.rs` tests

| In-tree test                              | Upstream status                                          |
| ----------------------------------------- | -------------------------------------------------------- |
| `test_identity_network_zero_error`        | ✅ Present                                               |
| `test_score_with_hidden_neuron`           | ✅ Present                                               |
| `test_multiple_records`                   | ✅ Present                                               |
| `test_dimension_mismatch_creature_inputs` | Obsolete (no `--inputs` flag).                           |
| `test_invalid_cost_function`              | Obsolete (no `--cost` flag).                             |
| `test_missing_creature_file`              | ✅ Present                                               |
| `test_version_penalty_in_score`           | ✅ Present                                               |
| `test_all_cost_functions_run`             | Obsolete (MSE only).                                     |
| `test_empty_data_directory`               | ✅ Present                                               |
| `test_json_output_format`                 | ✅ Present (checks the additional telemetry fields too). |

**Upstream-only test:**
`stream_score.rs::partition_packed_records_covers_all_and_balances`.

## 4. Acceptance criteria resolution

| Criterion                                                                                           | Status                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parity matrix covering `cost.rs`, `main.rs`, `scoring.rs` recorded                                  | ✅ This document, sections 2.1–2.3.                                                                                                                                                                            |
| Every `pub` item in in-tree `rust_scorer/src/**` confirmed present or deliberately omitted upstream | ✅ Section 2 tables.                                                                                                                                                                                           |
| Every `#[test]` in in-tree `rust_scorer/src/**` has an equivalent upstream test                     | ✅ Section 3 tables; obsolete tests are documented with reason (CLI flags removed / MSE-only).                                                                                                                 |
| Cost-function dispatch gap explicitly resolved                                                      | ✅ Section 2.1: five non-MSE functions exist as fused batch variants in `neat_core::loss::*_sum_batch_packed`; the scorer CLI itself remains MSE-only by design. Upstream issue filed to document/re-evaluate. |
| Any missing items have corresponding issues in NEAT-AI-scorer                                       | ✅ See "Upstream issues" below.                                                                                                                                                                                |
| TypeScript callers still resolve expected CLI behaviour                                             | ✅ N/A — zero TypeScript callers spawn the binary.                                                                                                                                                             |
| `./quality.sh` still passes                                                                         | ✅ Audit is documentation only; no code change.                                                                                                                                                                |

## 5. Upstream issues

Raised on `stSoftwareAU/NEAT-AI-scorer`:

- **[NEAT-AI-scorer#9](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/9)**
  — "Document cost-function scope: MSE-only CLI vs multi-cost in-tree
  experiment". Captures the decision to keep the scorer CLI MSE-only and
  references the fused `neat_core::loss::*_sum_batch_packed` variants that
  remain reachable in-library. Tracks whether a future `--cost` flag should be
  re-added or explicitly closed off in README.

No other gaps identified.
