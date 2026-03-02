## Summary

Replaced exponential decay with cosine annealing (SGDR / Loshchilov &
Hutter 2017) for the warm restart learning rate schedule. Closes #1656.

The previous implementation used `lr = initialLR * decay^position` which drops
quickly and uniformly. The new cosine schedule uses:

```
lr = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(π * T_cur / T_i))
```

This decays slowly at first (exploration), accelerates in the middle, and slows
near the minimum (fine-tuning), before resetting — spending more time at useful
moderate learning rates.

## Evidence

Benchmark results from `bench/CosineAnnealingWarmRestart.ts` (500 iterations, 20
trials, 3-input/2-output production-sized creature with 7 hidden neurons across
2 layers):

```
Config: initial=0.01, decay=0.95, period=10 => COSINE wins
Config: initial=0.01, decay=0.9, period=20  => COSINE wins
Config: initial=0.05, decay=0.95, period=10 => COSINE wins
Config: initial=0.05, decay=0.9, period=50  => COSINE wins

Cosine annealing wins in 4/4 configurations.
```

Learning rate curve comparison (period=10, decay=0.95):

```
Iter | Exponential     | Cosine Annealing
   0 |     0.01000000 |     0.01000000   (both start at max)
   1 |     0.00950000 |     0.00990180   (cosine decays slower at start)
   5 |     0.00773781 |     0.00799368   (cosine stays higher mid-period)
   9 |     0.00630249 |     0.00608557   (cosine reaches lower at end)
  10 |     0.01000000 |     0.01000000   (both reset)
```

This is a backend/algorithm change with no visual output.

## Test Plan

- Added `warm_restart uses cosine annealing schedule` test verifying the cosine
  formula at start, mid-period, and the slow-start/fast-end decay property
- Added `warm_restart cosine reaches minimum at end of period` test verifying
  period reset behaviour
- All 12 learning rate scheduling tests pass
- All 4328 tests pass (`./quality.sh`)
