## Summary

Replaced 36 relative import paths across 6 files with their import map aliases
defined in `deno.json`. This eliminates Deno "import specifier can be remapped"
warnings for cross-directory imports that have configured aliases.

The following import map aliases were applied:

- `@architecture/` for `src/architecture/`
- `@errors/` for `src/errors/`
- `@methods/` for `src/methods/`
- `@neat/` for `src/NEAT/`
- `@optimize/` for `src/optimize/`
- `@propagate/` for `src/propagate/`
- `@utils/` for `src/utils/`

Files modified:

- `src/NEAT/Mutator.ts` — 3 imports remapped
- `src/NEAT/Neat.ts` — 5 imports remapped
- `src/architecture/Offspring.ts` — 5 imports remapped
- `src/blackbox/FineTune.ts` — 6 imports remapped
- `src/creature/CreatureSerialization.ts` — 10 imports remapped
- `src/multithreading/workers/WorkerProcessor.ts` — 7 imports remapped

Closes #2091.

## Evidence

All 5151 existing tests pass. No functional changes — only import specifier
strings were updated to use the configured import map aliases.

## Test Plan

- All existing tests continue to pass (5151 passed, 0 failed)
- Quality gate (`quality.sh`) passes: formatting, linting, type-checking, tests
- No new tests required — this is a purely mechanical import path change
