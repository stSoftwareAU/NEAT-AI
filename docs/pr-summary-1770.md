## Summary

Audit WASM and activation function tests (~44 files, ~503 test cases) across
`test/wasm/`, `test/methods/`, and `test/squash/`. Closes #1770.

### Pass 1 Changes

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

### Pass 2 Changes

**Removed redundant tests:**

- `test/wasm/WasmAutoInit.ts`: Removed "isProbablyWorkerScope returns a boolean"
  test — completely redundant with the preceding test that already asserts the
  function returns `false` (a boolean) in the main thread.

- `test/wasm/WasmFacadeRefactoring.ts`: Removed "isProbablyWorkerScope returns
  false in main thread" — duplicate of the same test in `WasmAutoInit.ts`.

**Removed "how" tests (implementation detail tests):**

- `test/wasm/WasmFacadeRefactoring.ts`: Removed "mod.ts re-exports all expected
  symbols" test that checked `typeof` on ~30 re-exported symbols. This tests
  module structure (implementation detail), not behaviour.

- `test/wasm/WasmModuleLoader.ts`: Consolidated 10 separate "returns a function
  after init" tests into a single test. Each test only checked
  `typeof fn === "function"` on internal getter functions — a "how" test
  pattern. Consolidated into one test that verifies all getters return non-null.

**Strengthened weak assertions:**

- `test/wasm/WasmFacadeRefactoring.ts`: Strengthened "wasmSafeZoneAdjustment"
  test from range check `[0, 1]` to specific value assertion (`1.0` for input
  well inside safe zone). Strengthened "wasmCalculateError" test from
  `isFinite()` check to also verify error direction (positive when target
  exceeds current).

- `test/wasm/WasmCreatureActivationLRU.ts`: Replaced 3 "does not throw"
  anti-pattern tests with meaningful assertions:
  - "noteUse does not throw" → verifies cache count increases after noteUse
  - "noteUse multiple times is safe" → verifies cache count stays at 1
  - "evictOldest with count 0/negative is a no-op" → verifies cache count
    is preserved
  - "evictOldest does not throw for large count" → verifies cache becomes empty

### Cross-area duplicates found

- `test/squash/TAN.ts` squash/unSquash tests duplicated coverage in
  `test/methods/activations/EdgeCases.ts`, `SquashRoundtrip.ts`, and
  `test/squash/activations/UnSquashHintTest.ts`.
- `test/wasm/WasmFacadeRefactoring.ts` `isProbablyWorkerScope` test duplicated
  `test/wasm/WasmAutoInit.ts`.

### Directories reviewed

- `test/wasm/` (27 files) — issues fixed as described above
- `test/methods/` (15 files) — issues fixed in pass 1
- `test/squash/` (2 files) — issues fixed in pass 1

## Test Plan

- All 4673 tests pass (0 failures)
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- Verified no silent test skips remain in audited files
- Verified all removed tests were either meaningless, duplicate, or "how" tests
