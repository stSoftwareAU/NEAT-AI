## Summary

Add L1/L2 weight and bias regularisation (weight decay) during backpropagation. Closes #1859.

Four new configurable parameters are added to `BackPropagationArguments`:
- `l1WeightDecay` / `l2WeightDecay` — L1 (sparsity) and L2 (decay) penalties for synapse weights
- `l1BiasDecay` / `l2BiasDecay` — L1 (sparsity) and L2 (decay) penalties for neuron biases

All default to 0 (disabled), preserving backward compatibility. When enabled:
- **L2** shrinks weights/biases proportionally to magnitude: `w *= (1 - lr * λ)`
- **L1** applies soft-thresholding, driving small values to zero and snapping to zero when the penalty exceeds the magnitude

Regularisation is applied via extracted helper functions (`applyWeightRegularisation`, `applyBiasRegularisation`) on all return paths of `limitWeight()` and `limitBias()`, ensuring it works both with and without gradient updates, and integrates cleanly with sparse training (`sparseRatio`).

## Evidence

- 15 weight regularisation tests and 8 bias regularisation tests all pass
- Existing 4516 tests continue to pass with no regressions
- Quality gate (`./quality.sh`) passes cleanly

## Test Plan

- `test/propagate/WeightRegularisation.ts` — 15 tests covering:
  - L2 weight decay reduces positive/negative weight magnitudes
  - L2 strength controls decay rate
  - L2 disabled when strength is 0
  - L2 works alongside gradient updates
  - L1 drives small weights toward zero
  - L1 snaps to zero when penalty exceeds weight
  - L1 strength controls sparsity pressure
  - Elastic net (L1+L2) combines penalties
  - Progressive reduction over multiple iterations
  - Integration with sparseRatio
  - Defaults to disabled (0)
- `test/propagate/BiasRegularisation.ts` — 8 tests covering:
  - L2 bias decay for positive/negative biases
  - L1 bias decay drives small biases to zero
  - L1 snap-to-zero behaviour
  - Elastic net for biases
  - Defaults to disabled (0)
