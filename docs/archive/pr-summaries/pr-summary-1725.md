## Summary

Aligned `ValidationError` API with `TopologyError` by adding a `reason` field
and fixing `Error.name` to always return `"ValidationError"`. Previously,
`ValidationError` repurposed `Error.name` to store the reason code, which
violated the standard `Error.name` convention and produced confusing stack
traces. Closes #1725.

## Changes

- Added `override readonly name = "ValidationError"` to `ValidationError`
- Added `readonly reason: ValidationErrorName` field to store the reason code
- Updated all catch sites (5 source files) to check `error.reason` instead of
  `error.name`
- Updated all test files (4 files) to assert against `error.reason`
- Updated documentation examples in `API_REFERENCE.md` and `TROUBLESHOOTING.md`

## Evidence

This is a backend API change with no UI impact. All 4587 tests pass, including
the updated `ValidationError` tests that verify:

- `error.name` always equals `"ValidationError"`
- `error.reason` contains the `ValidationErrorName` value
- API alignment with `TopologyError` pattern

## Test Plan

- Updated `test/errors/ValidationError.ts` — all reason tests now check
  `.reason` and verify `.name === "ValidationError"`
- Added new test `"ValidationError - API aligned with TopologyError"` to
  explicitly verify alignment
- Updated `test/validate/CreatureValidate.ts` — all 20+ catch-site assertions
  updated to use `.reason`
- Updated `test/validate/FeedbackLoopCondition.ts` — updated to use `.reason`
- Updated `test/docs/TroubleshootingGuide.ts` — 4 tests updated to use `.reason`
