## Summary

JSR rejects packages that modify global types via `declare global`. The
`src/globals.d.ts` file augmented the global scope with two custom flags
(`__NEAT_AI_SKIP_WASM_AUTO_INIT` and `DEBUG`), causing `deno publish` to
fail with: *"modifying global types globals.d.ts:10:1"*.

Replaced `src/globals.d.ts` with `src/globalAccessors.ts` — a small utility
module that provides typed getter/setter functions for these two global
flags using an explicit `globalThis` cast, avoiding any `declare global`
augmentation. All call-sites updated to use the new accessors. Closes #1429.

## Evidence

This is a backend/CLI change with no visual output. Evidence:

- `deno publish --dry-run --allow-dirty` now completes successfully with
  `"Dry run complete"` (previously failed with the global types error).
- All 2887 existing tests pass after the change.

## Test Plan

- Updated `test/config/GlobalDeclarations.ts` to exercise the new
  `getGlobalDebug` / `setGlobalDebug` and `getSkipWasmAutoInit` /
  `setSkipWasmAutoInit` accessors (round-trip set/get verification).
