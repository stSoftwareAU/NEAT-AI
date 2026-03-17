## Summary

Fixed `limitValue()` in `src/propagate/BackPropagation.ts` to guard against
`NaN` and `Infinity` inputs. The function is called from `toValue()` after WASM
`unSquash` operations that could produce non-finite results. Previously, `NaN`
would pass through unchecked because `NaN > 1e12` and `NaN < -1e12` both
evaluate to `false`.

The fix (applied in #1363) uses `Number.isFinite()` to catch all non-finite
values upfront: `NaN` returns `0` (a safe neutral value), and
`Infinity`/`-Infinity` clamp to `+/-1e12`.

This PR adds additional edge case tests to strengthen coverage for issue #1364.

## Evidence

This is a backend bug fix with no UI changes. The fix is verified by unit tests:

```
running 9 tests from ./test/propagate/LimitValue.ts
limitValue - clamps positive values above 1e12 ... ok
limitValue - clamps negative values below -1e12 ... ok
limitValue - passes through normal values ... ok
limitValue - clamps positive Infinity to 1e12 ... ok
limitValue - clamps negative Infinity to -1e12 ... ok
limitValue - converts NaN to 0 ... ok
limitValue - converts computed NaN values to 0 ... ok
limitValue - handles negative zero ... ok
limitValue - passes through values just inside boundaries ... ok

ok | 9 passed | 0 failed
```

Full quality gate passed: 2208 tests passed, 0 failed.

## Test Plan

- `test/propagate/LimitValue.ts` — 9 tests covering:
  - Clamping positive/negative values above/below `+/-1e12`
  - Pass-through of normal values including boundary values at exactly `+/-1e12`
  - `Infinity` clamped to `1e12`
  - `-Infinity` clamped to `-1e12`
  - `NaN` converted to `0`
  - Computed `NaN` values (`0/0`, `Infinity - Infinity`, `Infinity * 0`)
    converted to `0`
  - Negative zero handled correctly
  - Values just inside boundaries pass through unchanged
