## Summary

Add import map aliases to `deno.json` for commonly imported internal modules,
replacing deep relative imports (`../../../` or deeper) with clean path aliases
across 39 files. This follows the established pattern already used for `@std/`
and `@stsoftware/` dependencies. Closes #1478.

## Changes

### Import map aliases added to `deno.json`:

- `@architecture/` → `./src/architecture/`
- `@errors/` → `./src/errors/`
- `@methods/` → `./src/methods/`
- `@neat/` → `./src/NEAT/`
- `@optimize/` → `./src/optimize/`
- `@propagate/` → `./src/propagate/`
- `@utils/` → `./src/utils/`
- `@globalAccessors` → `./src/globalAccessors.ts`

### Files updated (39 total):

- **30 activation type files** (`src/methods/activations/types/*.ts`) - replaced
  `@propagate/`, `@errors/`, `@optimize/` aliases
- **3 activation aggregate files** (`src/methods/activations/aggregate/*.ts`) -
  replaced `@propagate/`, `@architecture/`, `@optimize/`, `@neat/`, `@utils/`
  aliases
- **2 worker files** (`src/multithreading/workers/deno/worker.ts`,
  `src/intelligentDesign/workers/deno/worker.ts`) - replaced `@globalAccessors`
  alias
- **1 architecture file**
  (`src/architecture/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts`) -
  replaced `@architecture/` alias

## Evidence

This is a pure refactoring change with no visual or behavioural changes:

- `deno check mod.ts` passes cleanly
- `deno publish --dry-run` succeeds (import map aliases are rewritten at publish
  time)
- `quality.sh --skip-discovery` passes: all 3826 tests pass
- Zero deep relative imports remain in `src/` (verified with grep)

## Test Plan

No new tests required - this is a mechanical import path refactoring. All 3826
existing tests pass, confirming no regressions.
