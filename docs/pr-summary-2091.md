## Summary

Replaced 2802 relative import paths across 901 files with their import map
aliases defined in `deno.json`. This eliminates all Deno language server
`import-map-remap` warnings ("The import specifier can be remapped to ...").

The following import map aliases were applied:

- `@architecture/` for `src/architecture/`
- `@errors/` for `src/errors/`
- `@methods/` for `src/methods/`
- `@neat/` for `src/NEAT/`
- `@optimize/` for `src/optimize/`
- `@propagate/` for `src/propagate/`
- `@utils/` for `src/utils/`
- `@globalAccessors` for `src/globalAccessors.ts`

Closes #2091.

## Evidence

All 5141 existing tests pass. No functional changes — only import specifier
strings were updated to use the configured import map aliases.

## Test Plan

- All existing tests continue to pass (5141 passed, 0 failed)
- Quality gate (`quality.sh`) passes: formatting, linting, type-checking, tests
- No new tests required — this is a purely mechanical import path change
