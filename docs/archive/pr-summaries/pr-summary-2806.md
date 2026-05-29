# PR Summary — Issue #2806

## Summary

Removed all user-facing documentation references to the `CATEGORICAL_ERROR` cost
so the docs match the post-removal code (dependency #2805), and recorded the
removal in the changelog. Closes #2806.

Changes:

- `docs/API_REFERENCE.md` — dropped the `"CATEGORICAL_ERROR"` cost-table row and
  rewrote the recommendation note to point multi-class users at `CROSS_ENTROPY`,
  noting argmax/top-1 accuracy is a reporting metric only.
- `docs/api/COSTS_AND_ACTIVATIONS.md` — dropped the `"CATEGORICAL_ERROR"` row,
  corrected the built-in count from seven to six, and removed it from the native
  off-load list (now matching `src/config/RustScorerConfig.ts`).
- `docs/config/TRAINING.md` — dropped `CATEGORICAL_ERROR` from the recognised
  supervised-cost list.
- `docs/ACTIVATION_FUNCTIONS.md` — dropped `CATEGORICAL_ERROR` from the SOFTMAX
  "Pair with" cell and the cost-coupling example (now `CROSS_ENTROPY`), required
  to satisfy the "no `docs/` reference" acceptance criterion.
- `CHANGELOG.md` — added a `### Removed` entry under `## [Unreleased]` recording
  the removal and the `CROSS_ENTROPY` guidance. The Unreleased #2791
  supervised-cost list already excluded `CATEGORICAL_ERROR` (updated when #2805
  merged), so no further edit was needed there.

No `docs/archive/**` historical records were edited, and no already-released
changelog entries were rewritten.

## Evidence

Docs-only change — no web interface to screenshot. Verification performed:

- `grep` confirms no file under `docs/` excluding `docs/archive/**` references
  `CATEGORICAL_ERROR`.
- `deno fmt --check` passes on all changed files.
- `markdownlint-cli2` reports 0 errors across the repository.
- Cross-checked the surviving cost set against the source of truth
  (`BUILT_IN_COST_NAMES` doc comment in `src/config/RustScorerConfig.ts`):
  `MSE`, `MAE`, `MAPE`, `MSLE`, `CROSS_ENTROPY`, `HINGE` — six names.

## Test Plan

This is a documentation-only change with no code paths, so no unit tests were
added. Validation:

- [x] `deno fmt --check` clean on changed files
- [x] `markdownlint-cli2` — 0 errors
- [x] No `CATEGORICAL_ERROR` references remain under `docs/` (excluding
      `docs/archive/**`)
- [x] `CHANGELOG.md` has the `### Removed` Unreleased entry with `CROSS_ENTROPY`
      guidance
