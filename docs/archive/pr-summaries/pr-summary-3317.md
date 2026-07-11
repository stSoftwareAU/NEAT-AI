## Summary

Removed the redundant `export` keyword from the module-private constant
`DEGRADED_MAX_NEURONS_FACTOR` in
`src/architecture/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts`.

A word-boundary search across every `.ts` file confirmed the constant has no
importer: it is declared once (line 63) and read once within its own module
(inside `computeDegradedAnalysisKnobs`). It is not re-exported from `mod.ts` and
no test imports it, so the `export` keyword added public API surface with no
consumer. Dropping it keeps the value module-private with identical behaviour.

Closes #3317.

## Evidence

Backend-only change with no web interface to screenshot. Verified via targeted
Deno checks on the affected module and its test:

- `deno fmt` — formatted, no changes needed.
- `deno lint` — clean (no unused-locals; the constant is still read internally).
- `deno check` — type-checks cleanly.
- `deno test test/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts` —
  6 passed, 0 failed.

The existing behavioural test
`computeDegradedAnalysisKnobs: reduces focus breadth to a quarter and bounds chunk size`
pins the `0.25` factor via `ceil(16 * 0.25) === 4`, so the quarter-reduction
behaviour that depends on this constant remains verified after the change.

## Test Plan

- No new test required — this is a visibility-only change with no behaviour
  delta. Coverage is provided by the existing suite in
  `test/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts` (6 tests),
  which continues to pass and asserts on the quarter-factor result the constant
  produces.
