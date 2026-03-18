## Summary

Add optional gradient normalisation for high fan-out neurons in topological
backpropagation. When `normaliseGradients` is enabled, accumulated error
signals are divided by `sqrt(targetDeltaCount)` instead of being summed
directly. This dampens gradient magnification in neurons with many outward
connections while preserving some scaling — similar to AdaGrad-style
normalisation. Closes #1872.

### Changes

- **`src/propagate/BackPropagation.ts`** — Added `normaliseGradients: boolean`
  to `BackPropagationArguments` (default `false` for backwards compatibility).
- **`src/propagate/TopologicalBackpropagation.ts`** — When
  `config.normaliseGradients` is true and a neuron has more than one downstream
  contributor, divide `targetDeltaSum` by `sqrt(targetDeltaCount)`.
- **`test/propagate/NormaliseGradients.ts`** — 5 new tests verifying the
  feature.

## Evidence

- Normalisation ratio measured at **4.47** for 20-output fan-out (matches
  expected `sqrt(20) = 4.47`).
- Skewed topology convergence improved from **23.0%** (sum mode) to **29.2%**
  (normalised mode) error reduction over 100 iterations.
- Single-downstream neurons produce identical results with or without
  normalisation (no regression).
- All **4671** existing tests continue to pass.

## Test Plan

- `NormaliseGradients - default false preserves summing behaviour` — verifies
  backwards-compatible default.
- `NormaliseGradients - reduces gradient magnification for high fan-out` —
  verifies sqrt-scaling dampens weight updates proportionally.
- `NormaliseGradients - single downstream unaffected` — verifies no impact on
  neurons with a single downstream path.
- `NormaliseGradients - improves convergence for skewed topology` — verifies
  both modes converge on a skewed-connectivity network.
- `NormaliseGradients - config option correctly set and frozen` — verifies
  config creation and immutability.
