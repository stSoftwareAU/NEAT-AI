## Summary

Added `docs/RUST_SCORER_PARITY_AUDIT.md` recording the audit of the in-tree
`rust_scorer/` crate against
[NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer). Closes #2368.

Key findings:

- `rust_scorer/` is **not on `Develop`** — it only exists on
  `milestone/pure-rust-scorer-experiment` (commit `d414dac5`, PR #1982, Issue
  #1967). No TypeScript caller in `src/**` spawns the binary, so there is no
  runtime parity risk today.
- Every `pub` item and `#[test]` in the in-tree files is either present in
  NEAT-AI-scorer verbatim, reachable via `neat_core::loss::*_sum_batch_packed`
  (the five non-MSE cost functions), or intentionally obsolete because the
  upstream CLI narrowed to MSE-only positional arguments.
- Cost-function dispatch gap is resolved: all six cost functions exist as fused
  batch variants in `neat_core::loss`; the scorer CLI is deliberately MSE-only
  per its README. Filed
  [NEAT-AI-scorer#9](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/9) to
  document that decision (or re-add `--cost` dispatch if wanted).

## Evidence

Documentation-only change — no UI or performance surface. Parity matrix in
`docs/RUST_SCORER_PARITY_AUDIT.md` cross-references the experiment-branch files
against NEAT-AI-scorer `main` at
[`rust_scorer/src/{cost.rs, main.rs, scoring.rs, stream_score.rs, bin/float_scan_bench.rs}`](https://github.com/stSoftwareAU/NEAT-AI-scorer/tree/main/rust_scorer/src).

## Test Plan

- [x] `./quality.sh --lint-only < /dev/null` passes (format + lint + bash
      checks).
- [x] Upstream issue filed:
      [NEAT-AI-scorer#9](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/9).
- [x] Audit doc linked from this PR and from the issue comment.
