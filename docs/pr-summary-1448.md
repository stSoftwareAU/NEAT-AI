## Summary

Add comprehensive unit tests for all 32 activation function implementations,
covering safe-zone adjustment logic, squash/unSquash roundtrip correctness,
range bounds compliance, monotonicity verification, and edge-case behaviour.
Closes #1448.

## Test Files

| File                                             | Tests | Purpose                                                                                                                                                                     |
| ------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/methods/activations/SafeZoneAdjustment.ts` | 65    | Safe-zone factor correctness: return range [0,1], non-finite handling, linear zone confidence, saturation attenuation, recovery logic                                       |
| `test/methods/activations/SquashRoundtrip.ts`    | 30    | `unSquash(squash(x)) ≈ x` roundtrip for all invertible activations, including periodic (SINE, Cosine, TAN), sign-ambiguous (ABSOLUTE, GAUSSIAN, SQUARE), and step functions |
| `test/methods/activations/RangeBounds.ts`        | 44    | `squash(x)` stays within declared `range()` bounds across 21 input values including extreme values (±1e6)                                                                   |
| `test/methods/activations/Monotonicity.ts`       | 28    | Monotonicity for 19 non-decreasing activations; non-monotonic behaviour verified for GAUSSIAN, Cosine, SINE, COMPLEMENT, ABSOLUTE, SQUARE, StdInverse                       |
| `test/methods/activations/EdgeCases.ts`          | 120   | Behaviour at x=0, large positive/negative, non-finite inputs (NaN, ±Infinity), boundary values, and `getName()` correctness for all 32 activations                          |

**Total: 287 new tests**

## Evidence

This is a pure backend/test change with no visual output. All 287 tests pass:

```
ok | 287 passed | 0 failed (235ms)
```

Type-checking, formatting, and linting all pass cleanly for the new files.

## Activations Covered

ArcTan, ABSOLUTE, BENT_IDENTITY, BIPOLAR, BIPOLAR_SIGMOID, COMPLEMENT, Cosine,
Cube, ELU, Exponential, GAUSSIAN, GELU, HARD_TANH, IDENTITY, ISRU, LeakyReLU,
LOGISTIC, LogSigmoid, Mish, ReLU, ReLU6, SELU, SINE, Softplus, SOFTSIGN, SQRT,
SQUARE, StdInverse, STEP, Swish, TAN, TANH

## Test Plan

- All 287 new tests pass with `deno test`
- Type-checking passes with `deno check`
- Formatting and linting pass with `deno fmt` and `deno lint`
- No existing tests were modified or removed
