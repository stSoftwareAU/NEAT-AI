## Summary

Migrate all remaining `console.*` calls in `src/` to use `getLogger()` from the
Logger abstraction for consistent log level control. Closes #1476.

### Changes

- **Removed commented-out debug code**: Deleted `// console.info(functionBody);`
  from `src/methods/activations/aggregate/IF.ts`
- **Updated 17 JSDoc examples** across 15 files to use `getLogger().info()`
  instead of `console.log()`, ensuring documentation demonstrates the correct
  logging pattern:
  - 6 cost function files (CrossEntropy, HINGE, MSE, MAE, MAPE, MSLE)
  - 3 architecture files (Score, Training, CreatureUtils)
  - 2 breed files (Breed, GeneticCompatibility)
  - 1 blackbox file (RestoreSource)
  - 1 intelligent design module (mod.ts)
  - 2 worker handler files (intelligentDesign and multithreading)

After these changes, the only `console.*` calls remaining in `src/` are inside
`src/utils/Logger.ts` itself (the Logger implementation that correctly delegates
to console methods).

## Evidence

This is a backend/code-only change with no UI. Verified by:

- `grep -r "console\." src/ --include="*.ts"` shows only Logger.ts references
- All 3635 tests pass
- `quality.sh` passes cleanly (fmt, lint, type-check, tests)

## Test Plan

- No new tests needed; this is a documentation and dead-code cleanup
- All 3635 existing tests continue to pass unchanged
