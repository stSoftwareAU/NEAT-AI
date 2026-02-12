## Summary

Three targeted improvements to the backpropagation training process. Closes #1388.

### 1. Error-feedback adaptive learning rate

The existing "adaptive" learning rate strategy was purely time-based — it used a slower decay with sinusoidal oscillation but never looked at actual training error. The comment in the code acknowledged: *"Could be enhanced to use actual error feedback in the future"*.

Now the adaptive strategy uses real error feedback from the training loop:
- **Error improving** (ratio < 0.95): slightly boost the rate (1.1x)
- **Error stagnating** (ratio 0.95–1.0): increase the rate to escape the plateau (1.3x)
- **Error worsening** (ratio > 1.0): reduce the rate proportionally (down to 0.5x)

The fixed and decay strategies are unchanged. Backward compatible — works without error feedback.

### 2. Weight-based elastic distribution fallback

When all activations are near zero (common during early training), the elastic error distribution previously fell back to an equal split across all links. This ignores that links with larger weights carry more influence.

Now the fallback uses `weight²` scoring — matching the approach already used by record-time elasticity (`RecordElasticity.ts`). Links with larger weights absorb proportionally more error. Falls back to equal split only when both activations and weights are zero.

### 3. Error-guided sparse neuron selection

When sparse training is active (`sparseRatio < 1`), neurons were previously selected randomly via Fisher-Yates shuffle. The `totalErrorAbsolute` field was already being accumulated during propagation but never read.

Now the accumulated per-neuron error data from the previous iteration is used to prioritise high-error neurons for training. This focuses training effort on neurons with the most room for improvement. Falls back to random selection when no error data is available (first iteration).

## Evidence

These are backend/algorithmic changes with no UI component. All 2271 tests pass including 16 new tests covering the three improvements. The `quality.sh` gate passes cleanly.

## Test Plan

### New tests
- `test/optimization/ErrorFeedbackLearningRate.ts` (5 tests):
  - Adaptive rate increases when error stagnates
  - Adaptive rate decreases when error worsens
  - Fixed and decay strategies ignore error feedback
  - Adaptive without error feedback still works (backward compatible)
  - Adaptive rate stays within reasonable bounds
- `test/propagate/WeightBasedElasticFallback.ts` (8 tests):
  - Weight-based fallback prefers larger weights
  - Equal weights give equal split
  - Uses absolute weight value (negative weights)
  - Falls back to equal split when no weight data
  - Activation-based scoring takes priority over weight-based
  - All zero weights fall back to equal split
  - Backward compatibility without weight field
  - Weight fallback with tiny activations below plankConstant
- `test/propagate/sparse/ErrorGuidedChooseNeurons.ts` (3 tests):
  - Error-guided selection prefers high-error neurons
  - Works without neuron errors (backward compatible)
  - sparseRatio 1 returns all neurons regardless of errors

### Modified tests
- `test/optimization/AdaptiveVsDecay.ts`: Updated oscillation test to verify error-feedback responsiveness instead of sinusoidal pattern
