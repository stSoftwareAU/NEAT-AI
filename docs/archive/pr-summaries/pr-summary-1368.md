## Summary

Extend negative zero (`-0`) normalisation to `parseDiscoverySampleRate()` in
`src/config/ParseOptions.ts`. The existing `parseNumber()` already normalised
`-0` to `0` (added in #1363), but `parseDiscoverySampleRate()` was missed.

In JavaScript, `-0 >= 0` evaluates to `true`, so `-0` silently passes range
checks. This can cause subtle bugs (e.g. `1 / -0 === -Infinity`). The fix adds
the same `Object.is(num, -0)` guard to `parseDiscoverySampleRate()`.

Also expanded the test file to cover `parseDiscoverySampleRate` with `-0`
inputs.

## Evidence

This is a backend/config change with no UI. All 2218 tests pass including the
new negative zero tests for both `parseNumber()` and
`parseDiscoverySampleRate()`.

## Test Plan

- Extended `test/config/ParseOptionsNegativeZero.ts` with 2 new tests:
  - `parseDiscoverySampleRate - normalises -0 to 0 for numeric input`
  - `parseDiscoverySampleRate - normalises '-0' string to 0`
- Existing 5 tests for `parseNumber()` negative zero handling remain unchanged
- Full quality gate (`./quality.sh`) passes: 2218 tests, 0 failures
