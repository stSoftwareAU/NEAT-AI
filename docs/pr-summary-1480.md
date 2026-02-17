## Summary

Add error-magnitude scaling to the adaptive learning rate strategy in backpropagation. Closes #1480.

The adaptive strategy previously only adjusted the learning rate based on error *direction* (improving, stagnating, or worsening). This enhancement adds a second scaling component based on error *magnitude*, inspired by fine-tuning's `QuantumStepConfig` approach:

- **Large errors** (far from optimum): learning rate scales up towards 2x, enabling bigger steps
- **Small errors** (fine-tuning region): learning rate stays near 1x, enabling conservative convergence

The magnitude scaling uses the same bounded normalisation as `QuantumStepConfig`:
```
normalisedError = |error| / (1 + |error|)  => bounded in [0, 1)
magnitudeScale = 1 + normalisedError       => bounded in [1, 2)
```

This bridges the scale gap between backpropagation and fine-tuning identified in the issue.

## Evidence

### Benchmark Results

```
Problem: input=0.5 -> target=0.3 (LOGISTIC hidden, IDENTITY output)
Iterations: 200, Trials per config: 10

Fixed LR=0.01 (default)             | mean=0.018904 | best=0.018904 | worst=0.018904
Fixed LR=0.001                      | mean=0.018912 | best=0.018912 | worst=0.018912
Fixed LR=0.1                        | mean=0.018140 | best=0.018140 | worst=0.018140
Decay (default)                     | mean=0.018907 | best=0.018907 | worst=0.018907
Adaptive (with magnitude)           | mean=0.018907 | best=0.018907 | worst=0.018907
Warm restart (default)              | mean=0.018905 | best=0.018905 | worst=0.018905
```

All strategies converge to similar final errors on this simple problem. The adaptive strategy with magnitude scaling performs comparably to other strategies. The enhancement is conservative — it adds magnitude awareness without disrupting convergence properties.

All 3873 existing tests pass.

## Test Plan

- Added `test/propagate/AdaptiveMagnitudeScaling.ts` with 8 tests:
  - Large error produces higher rate than small error
  - Magnitude scale approaches 2x for very large errors
  - Magnitude scale is 1x when error is near zero
  - Worsening error still reduces rate despite large magnitude
  - Stagnation with moderate error boosts appropriately
  - Fixed strategy unaffected by error magnitude
  - No feedback falls back to magnitude scale of 1
  - Magnitude scale is monotonically increasing with error
- Updated 3 existing tests in `test/propagate/BackPropagationConfig.ts` to account for magnitude scaling
- Added benchmark `bench/AdaptiveLearningRateConvergence.ts`
