## Summary

Fix predictive coding producing no gains on complex creatures (30-90+ neurons).
Closes #1915.

**Root causes identified:**

1. Energy threshold `1e-6` is per-network, not per-neuron — unreachable when 90+
   error terms sum to total energy
2. Inference rate `0.05` causes oscillation in large networks due to large
   gradient sums from many downstream neurons
3. Learning rate `0.001` produces imperceptible weight changes spread across
   many parameters
4. No gradient normalisation — deep topologies can produce divergent gradient
   magnitudes

**Fixes implemented:**

- Adaptive scaling module (`src/predictiveCoding/AdaptiveScaling.ts`) that
  adjusts PC parameters based on network topology:
  - `inferenceRate ÷ √(hiddenCount / 10)` — prevents oscillation
  - `energyThreshold × (nonInputCount / 10)` — makes convergence achievable
  - `learningRate × √(hiddenCount / 10)` — keeps updates meaningful
- Gradient L2 norm clipping (max 1.0) in inference settling loop — prevents
  divergence in deep topologies
- Scaling only applies when hidden neuron count > 10, preserving existing
  small-network behaviour

## Evidence

- All 4778 existing tests pass with no regressions
- New test
  `PC training with default config + adaptive scaling reduces error on 36-neuron creature`
  validates that **default** PC config now produces measurable error reduction
  on complex creatures without manual tuning
- Existing complex creature tests (36 and 51 hidden neurons) continue to pass

## Test Plan

- Added `test/predictiveCoding/AdaptiveScaling.ts` with 7 tests:
  - Small network (≤10 hidden) returns config as-is
  - Large network scales inference rate down
  - Large network scales energy threshold up
  - Large network scales learning rate up
  - Boundary case: exactly 10 hidden neurons returns config as-is
  - Larger networks get more scaling (proportionality)
  - Default config + adaptive scaling reduces error on 36-neuron creature
- All 76 existing PC tests pass unchanged
- Full quality gate (`quality.sh`) passes: 4778 tests, 0 failures
