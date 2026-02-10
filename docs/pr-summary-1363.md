## Summary

Suggest improvements (#1363): Created 5 GitHub issues identifying concrete bugs and enhancements, then implemented and tested fixes for all of them.

### Issues Created
- **#1364** - Bug: `limitValue()` does not guard against NaN inputs
- **#1365** - Bug: Broken string formatting in `CreatureValidate.ts` error messages
- **#1366** - Bug: `compactUnused` bias adjustment can produce non-finite values
- **#1367** - Improvement: Simplify redundant `feedbackLoop` condition in `CreatureValidate.ts`
- **#1368** - Improvement: `parseNumber()` should reject negative zero (`-0`)

### Changes Made
1. **`src/propagate/BackPropagation.ts`** - `limitValue()` now handles `NaN` (returns 0) and `Infinity`/`-Infinity` (clamps to ±1e12) instead of letting them pass through unchecked
2. **`src/architecture/CreatureValidate.ts`** - Fixed 3 broken template string error messages containing leftover `+ "` concatenation fragments; simplified redundant `feedbackLoop !== undefined && feedbackLoop === false` to `feedbackLoop === false`
3. **`src/compact/CompactUnused.ts`** - Added `Number.isFinite()` guard to bias adjustment in the non-constant path of `removeNeuron()`, consistent with the existing guard in the constant path
4. **`src/config/ParseOptions.ts`** - `parseNumber()` now normalises `-0` to `0` to prevent subtle bugs (e.g. `1 / -0 === -Infinity`)

## Evidence

This is a backend/CLI change with no visual UI. All changes are verified through unit tests (see Test Plan below). All 2205 tests pass including 15 new tests.

## Test Plan

- **`test/propagate/LimitValue.ts`** (6 tests) - Tests `limitValue()` with normal values, values exceeding ±1e12, `Infinity`, `-Infinity`, and `NaN`
- **`test/architecture/CreatureValidateErrorMessages.ts`** (2 tests) - Verifies error messages for output UUID mismatch and neuron ordering violations do not contain leftover concatenation fragments
- **`test/compact/CompactUnusedFiniteGuard.ts`** (2 tests) - Verifies `removeNeuron()` guards against non-finite bias results and rejects removal when bias would overflow
- **`test/config/ParseOptionsNegativeZero.ts`** (5 tests) - Verifies `parseNumber()` normalises `-0` to `0` for both numeric and string inputs while leaving normal values unaffected
