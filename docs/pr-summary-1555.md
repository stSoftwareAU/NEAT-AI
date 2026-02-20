## Summary

Implement the "slow" learning phase of Predictive Coding — local Hebbian-like weight update rules that adjust synaptic weights based on prediction errors after inference has settled. This is the key differentiator from standard backpropagation: each synapse update depends only on locally available information (pre-synaptic activity, post-synaptic error, and the local activation derivative). Closes #1555.

### Weight update rule
```
ΔW(j→i) = η_learn · f'(a(i)) · ε(i) · x(j)
Δb(i)   = η_learn · f'(a(i)) · ε(i)
```

### Key features
- `computeWeightGradients()`: computes local Hebbian gradients from settled inference state, using the correct activation function derivative for each neuron
- `applyHebbianUpdate()`: applies gradients while respecting plank precision (1e-7), synapse type constraints (positive/negative/condition), and weight bounds
- Batch accumulation supported via gradient averaging across multiple samples before applying a single update

## Evidence

This is a backend/algorithmic change with no visual output. Correctness is verified by 12 unit tests with hand-computed expected values and constraint validation. All 4221 tests pass including the 12 new tests. `./quality.sh` passes cleanly.

## Test Plan

New test file: `test/predictiveCoding/PredictiveCodingLearning.ts` (12 tests)

- **Hand-computed weight deltas (IDENTITY)**: verifies ΔW = η · 1 · ε · x against manually computed values
- **Hand-computed weight deltas (LOGISTIC)**: verifies correct σ(x)·(1-σ(x)) derivative usage
- **Energy decreases over epochs**: verifies prediction error energy reduces with repeated learning
- **Plank precision**: weights below 1e-7 magnitude snap to zero
- **Positive synapse constraint**: positive-typed synapses remain ≥ 0 after aggressive updates
- **Negative synapse constraint**: negative-typed synapses remain ≤ 0 after aggressive updates
- **Condition synapse immutability**: condition-typed synapses are never modified
- **Batch averaging**: accumulated gradients produce correct mean deltas
- **Batch vs sequential**: batch mode produces different results from online mode (verifying distinct code paths)
- **TANH derivative**: verifies 1 - tanh²(a) derivative is used correctly
- **ReLU derivative**: verifies piecewise derivative (1 for positive, 0 for negative) is used correctly
- **Zero errors → zero gradients**: converged inference produces near-zero weight updates
