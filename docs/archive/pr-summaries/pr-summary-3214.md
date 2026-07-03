## Summary

Removed the redundant `export` keyword from the retry-cap constant
`MOD_WEIGHT_MAX_RETRIES` in `src/mutate/ModWeight.ts`. Static module-graph
analysis confirmed no other module in the repository (`src/**`, `test/**`,
`bench/**`, `mod.ts`) imports the symbol; it is used only internally by the
bounded no-op retry loop in `performMutation` (Issue #2383). Narrowing it to a
module-private constant removes dead public surface without changing any
behaviour. Closes #3214.

Verification performed before the change:

- `grep -rn "MOD_WEIGHT_MAX_RETRIES"` across `src`, `test`, `bench`, `mod.ts`,
  `docs`, `scripts` — the only references are the definition at line 24 and the
  internal use at line 110 of the same file.
- `ModWeight.ts` is not re-exported from `mod.ts`, and no `export *` barrels
  exist under `src/mutate/` that could re-export it implicitly.
- No dynamic/reflective use found — the constant is referenced only by name in
  its defining file.

## Evidence

Backend/library change only — no web interface to screenshot.

The internal retry loop that consumes `MOD_WEIGHT_MAX_RETRIES` is already
covered by the behavioural tests in `test/mutate/ModWeightNoOpRetry.ts`, which
exercise the bounded-retry behaviour without importing the constant. These tests
continue to pass after the change, confirming behaviour is preserved while the
symbol becomes module-private.

Test evidence:

- `deno check src/mutate/ModWeight.ts` — clean.
- `deno lint src/mutate/ModWeight.ts` — clean.
- `deno test -A test/mutate/ModWeight*.ts` — `27 passed | 0 failed`.

Note: the full `quality.sh` run shows one pre-existing, unrelated failure in
`test/ErrorGuidedStructuralEvolution/NeuronDiscoveryIntegration.ts` (an
unhandled `setWeight` variant in `DiscoverAnalysis.ts`). It was confirmed to
fail identically on the unmodified base branch (via `git stash`) and is not
connected to this single-keyword change.

## Test Plan

- Existing `test/mutate/ModWeightNoOpRetry.ts` — verifies the bounded retry loop
  governed by `MOD_WEIGHT_MAX_RETRIES` (retries past a no-op synapse, returns
  false cleanly when no change is possible, never reports a change without one).
  No import of the constant, so it remains a "what" test.
- Existing `test/mutate/ModWeightBehavioural.ts`, `ModWeightRegularisation.ts`,
  `ModWeightFocus.ts`, `ModWeightFocusFiltering.ts` — full ModWeight suite
  passes (27 tests).

No new tests were added: the change removes public surface only, and adding a
test that greps the source for the `export` keyword would be a forbidden "how"
test per `AGENTS.md`.
