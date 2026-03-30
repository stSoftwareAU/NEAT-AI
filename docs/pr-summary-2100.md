## Summary

Fixed CI/local formatting discrepancy that caused spurious commits and WASM
rebuilds after running `quality.sh`. Closes #2100.

**Root cause:** `quality.sh` ran `deno fmt src test bench mod.ts docs` (explicit
paths) while CI's `quality.yml` ran `deno fmt` (all files). The CI invocation
reformatted generated files in `wasm_activation/pkg/` that `quality.sh` never
touched, causing CI to detect changes, commit them, and potentially trigger
unnecessary WASM rebuilds.

**Fix:**

1. Added `wasm_activation/pkg` and `wasm_activation/target` to `deno.json`'s
   `exclude` list so generated WASM files are never formatted, linted, or
   type-checked by either local or CI runs.
2. Changed `quality.sh`'s `deno fmt` to run without explicit path arguments,
   matching CI's invocation exactly. Both now rely on `deno.json` excludes for
   consistent behaviour.

## Evidence

- `deno fmt --check` (no path args) passes cleanly after the change
- All 5168 tests pass including 2 new format consistency tests

## Test Plan

- Added `test/scripts/FormatConsistency.ts` with two tests:
  - `deno fmt --check passes with no path arguments (CI-consistent)` - verifies
    the project is consistently formatted when using the same command as CI
  - `wasm_activation/pkg files are not touched by deno fmt` - verifies generated
    WASM files are excluded from formatting
