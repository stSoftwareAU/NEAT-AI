## Summary

Add production-scale creature backpropagation convergence validation test.
Closes #1875.

A new test file `test/propagate/large/ProductionScale.ts` generates a
deterministic ~1,060-neuron, ~18,000+ synapse creature with diverse squash
functions (including IF, MAXIMUM, MINIMUM aggregates), multiple hidden layers,
and skip connections. Four tests validate:

1. **Dimension check** — creature meets production scale targets
2. **Convergence** — backpropagation with `normaliseGradients: true` reduces
   training error with all weights/biases remaining finite
3. **Comparison** — side-by-side convergence of `normaliseGradients: false` vs
   `true`, documenting the improvement from #1872
4. **Finiteness guard** — weights, biases, and activations remain finite across
   multiple training iterations

## Evidence

All four tests pass reliably with deterministic seeded PRNG (no flaky timing
assertions). The creature generator produces consistent topologies across runs.

## Test Plan

- Added `test/propagate/large/ProductionScale.ts` with 4 tests:
  - `production-scale: creature meets target dimensions`
  - `production-scale: backprop converges with normalised gradients`
  - `production-scale: normalised vs unnormalised gradient convergence comparison`
  - `production-scale: weights and biases remain finite across iterations`
- No existing tests modified or removed
