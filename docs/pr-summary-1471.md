# Backprop: Add bias-weight coordination to prevent opposing updates (#1471)

Closes #1471

## Summary

During backpropagation, bias and weight updates are computed independently. When
these updates have opposing net effects on the neuron's pre-activation value,
they can cancel each other out, wasting gradient computation. This PR adds a
coordination step that detects and mitigates such opposing effects.

## Key Design Decisions

### Effect-based comparison (not raw deltas)

The actual effect of a weight change depends on the source neuron's activation:
`effect = weight_delta * activation`. A weight decrease with a negative
activation actually _increases_ the output (aligned with a bias increase). The
coordination compares `biasDelta` against `sum(weightDelta * activation)` to
correctly identify opposing effects.

### Conservative threshold (0.95)

Coordination only triggers when the smaller opposing force is at least 95% of
the larger (near-perfect cancellation). This avoids interfering with gradient
updates where opposing forces are unequal enough to still produce a meaningful
net change.

### Reduce both sides proportionally

When cancellation is detected, both the bias and weight changes are reduced by
`reductionFactor` (default 0.2). This avoids asymmetry where reducing only one
side could push the neuron in the wrong direction during early training.

### Minimum sample count

Coordination requires at least `max(batchSize, 4)` accumulated samples per
synapse before activating. With too few samples, gradient signals are too noisy
for coordination to be reliable.

## Changes

- **New**: `src/propagate/BackpropCoordination.ts` - Core coordination module
  with `coordinateBackpropUpdates()` function
- **New**: `test/propagate/BackpropCoordination.ts` - 20 unit tests covering all
  coordination scenarios
- **Modified**: `src/propagate/BackPropagation.ts` - Added
  `biasWeightCoordinationFactor` config option (default 0.2, range 0..1)
- **Modified**: `src/architecture/Neuron.ts` - Integrated coordination into
  `propagateUpdate()`

## Test plan

- [x] 20 unit tests for coordination logic (opposing, aligned, threshold
      boundary, activations, edge cases)
- [x] All 3626 existing tests pass
- [x] Convergence tests (Constants, SingleNeuron) pass
- [x] XNOR evolve integration test passes
- [x] quality.sh passes (fmt, lint, type-check, tests)
