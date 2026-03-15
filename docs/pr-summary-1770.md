## Summary

Audit WASM and activation function tests (~44 files, ~503 test cases) across
`test/wasm/`, `test/methods/`, and `test/squash/`. Closes #1770.

### Changes

**Removed meaningless tests:**

- `test/methods/activations/EdgeCases.ts`: Removed 32 trivial `getName()` tests
  that only verified `Activations.find("X").getName() === "X"` — a meaningless
  round-trip through the lookup function already tested elsewhere.

**Removed duplicate tests:**

- `test/squash/TAN.ts`: Removed squash and unSquash tests duplicated by
  `EdgeCases.ts`, `SquashRoundtrip.ts`, and `UnSquashHintTest.ts`. Retained the
  unique `simplifyBias` tests and split into properly named individual tests.

**Strengthened weak assertions:**

- `test/methods/activations/ActivationErrorIntegration.ts`: Replaced manual
  `try/catch` + `throw new Error(...)` patterns with proper `assertThrows` +
  `assertEquals`. Removed redundant `assertIsError` calls after `assertThrows`
  already validates the error type.
- `test/methods/activations/CalculateError.ts`: Converted silent
  `if (!hasCalculateError(act)) return` skips to
  `assert(hasCalculateError(act))` — these activations are explicitly listed as
  implementing `calculateError`, so a missing implementation should fail, not
  silently pass. Converted silent `if (current === target) return` to
  `assertNotEquals`.
- `test/methods/activations/SquashRoundtrip.ts`: Converted silent
  `if (!hasUnSquash(activation)) return` to `assert(hasUnSquash(activation))`.

**Removed dead code:**

- `test/squash/activations/UnSquashHintTest.ts`: Removed dead diagnostic
  `console.log` in the test helper that could never cause a test failure (the
  actual assertion was already present on the following lines).

### Cross-area duplicates found

- `test/squash/TAN.ts` squash/unSquash tests duplicated coverage in
  `test/methods/activations/EdgeCases.ts`, `SquashRoundtrip.ts`, and
  `test/squash/activations/UnSquashHintTest.ts`.

### Directories reviewed

- `test/wasm/` (27 files) — no issues found; well-structured behavioural tests
- `test/methods/` (15 files) — issues fixed as described above
- `test/squash/` (2 files) — issues fixed as described above

## Test Plan

- All 4685 tests pass (0 failures)
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- Verified no silent test skips remain in audited files
- Verified all removed tests were either meaningless or duplicated
