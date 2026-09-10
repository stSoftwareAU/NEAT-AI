## Summary

`test/mutate/ModBiasRegularisation.ts` asserted an L2 property over 500
**unseeded** draws of a _drifting_ random walk, so it failed at random. Under
the test's config the bias collapses from 50 to well under 1 within a handful of
mutations, and near zero the L2 pull is negligible beside the noise term — the
towards/away count is then close to a coin flip, which is why an unseeded run
could report `TowardsZero: 221, AwayFromZero: 279` and break a green branch.

The test now:

- drives the draws from the repo's seeded RNG (`createSeededRng`, guarded by
  `withRngTestLock`) so the outcome is reproducible from the test alone;
- **measures the pull at a fixed bias magnitude** — the bias is reset to 50
  before each draw — instead of following a walk that has already settled;
- uses a threshold derived from the operator's own arithmetic rather than the
  hand-picked `* 0.8` factor: with `l2Strength = 0.8` and a bias of 50 the
  modification is `0.2·(2u₁−1)·10 − 0.64·50·u₂`, so the pull towards zero only
  loses when `u₂ < (2u₁−1)/16` with `u₁ > ½` — probability **1.6%**. The test
  asserts a **90%** floor against that 98.4% mean;
- adds a second, compounding assertion — an unreset walk from 50 must end under
  1 — preserving the original "biases towards smaller biases" intent.

No production code changed; `ModBias` was never at fault. Closes #3998.

## Evidence

Backend/test-only change — there is no web interface to screenshot.

Measured with a scratch probe (since deleted) that ran both the old and new
assertions over **3000 seeds** of the same PRNG:

| assertion                                               | worst case over 3000 seeds | threshold   | outcome                                              |
| ------------------------------------------------------- | -------------------------- | ----------- | ---------------------------------------------------- |
| old — drifting walk, `towardsZero > awayFromZero * 0.8` | ratio `0.79`               | `0.8`       | **6 seeds fail** (695, 1491, 1593, 1947, 2123, 2688) |
| new — fixed-magnitude pull, `towardsZero >= 90%`        | `481 / 500` (96.2%)        | `450 / 500` | passes every seed                                    |
| new — walk ends under 1                                 | `0.66`                     | `< 1`       | passes every seed                                    |

Test run after the change:

```
running 12 tests from ./test/mutate/ModBiasRegularisation.ts
ModBias - L2 regularisation biases towards smaller biases ... ok (4ms)
ModBias - L2 pull holds under the seeds that broke the old sample ... ok (4ms)
...
ok | 12 passed | 0 failed (30ms)
```

## Reproduction

- **symptom** — `ModBias - L2 regularisation biases towards smaller biases`
  failed at random during `./quality.sh` on an unrelated branch:
  `AssertionError: ... TowardsZero: 221, AwayFromZero: 279`
- **status** — `verified` — the old assertion was driven from the seeded RNG and
  observed **failing** on seeds 695, 1491, 1593, 1947, 2123 and 2688 (6 of 3000,
  matching the observed rarity); the replacement assertion passes on every one
  of those seeds, and the file's 12 tests pass after the fix
- **regression test** —
  `test/mutate/ModBiasRegularisation.ts::ModBias - L2 pull holds under the seeds that broke the old sample`

## Test Plan

- Rewrote
  `test/mutate/ModBiasRegularisation.ts::ModBias - L2 regularisation biases towards smaller biases`
  to run under a seeded RNG with a distribution-derived threshold, plus a
  compounding walk assertion.
- Added
  `test/mutate/ModBiasRegularisation.ts::ModBias - L2 pull holds under the seeds that broke the old sample`,
  pinning three seeds that broke the previous shape.
- No existing test was removed or disabled; the other 10 tests in the file are
  untouched.
