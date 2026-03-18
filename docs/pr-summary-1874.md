## Summary

Improved gradient flow for MAXIMUM, MINIMUM, and IF aggregate functions during backpropagation. Closes #1874.

**MAXIMUM/MINIMUM**: Previously used winner-take-all gradient flow where only the single winning connection received the error signal. Now, non-winning connections whose values are close to the winner (within 20% of the winning value's magnitude) receive a small fraction (up to 15%) of the error via weight accumulation. This prevents dead gradient paths for runner-up connections while keeping the winner dominant.

**IF**: Previously distributed error equally across eligible branches (`error / count`). Now uses activation-magnitude-weighted distribution where connections with larger `|weight * activation|` absorb proportionally more error, consistent with the elastic distribution pattern used by standard neurons. Falls back to equal distribution when all magnitudes are near zero.

Forward pass behaviour is unchanged — only gradient flow during backpropagation is modified.

## Evidence

- All 4684 existing tests pass (including existing MAXIMUM, MINIMUM, and IF propagation tests)
- New tests verify non-winner gradient flow and convergence improvement

## Test Plan

- `test/propagate/MaximumGradientFlow.ts` — Verifies non-winner connections close to the winner receive gradient, and convergence improvement with multiple MAXIMUM connections
- `test/propagate/MinimumGradientFlow.ts` — Verifies non-winner connections close to the winner receive gradient, and convergence improvement with multiple MINIMUM connections
- `test/propagate/IFWeightedDistribution.ts` — Verifies activation-magnitude-weighted error distribution, and convergence improvement with IF aggregate neurons
