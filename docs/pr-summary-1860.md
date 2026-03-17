## Summary

Implements true dropout regularisation during training. During training, a
configurable fraction of hidden neurons are randomly disabled (activations set
to zero) and remaining activations are scaled by 1/(1-p) using inverted dropout.
During inference, all neurons are active and no adjustment is needed. Closes
#1860.

### What was done

1. **Forward-pass dropout** — After the WASM forward pass during training,
   hidden neuron activations are randomly zeroed according to the configured
   `dropoutRate`. This prevents co-adaptation of neurons and provides
   regularisation against overfitting.

2. **Inverted dropout** — Remaining (kept) activations are scaled by
   `1/(1-dropoutRate)` during training so that expected activation magnitudes
   remain consistent with inference, where all neurons are active.

3. **Configuration** — Added a `dropoutRate` parameter (0.0 to 1.0) to
   `BackPropagationArguments` (and therefore `TrainOptions`). Default is 0.0
   (disabled) for backward compatibility.

4. **Interaction with sparse training** — Dropout and `sparseRatio` coexist
   independently. Dropout provides regularisation (prevents overfitting) while
   sparse training provides efficiency (selects which neurons to update).

### Files changed

- `src/propagate/Dropout.ts` — New file implementing `applyDropout()` with
  inverted dropout scaling
- `src/propagate/BackPropagation.ts` — Added `dropoutRate` field to
  `BackPropagationArguments` with default 0
- `src/architecture/Training.ts` — Integrated dropout call in training loop
  after `activateAndTrace` and before `propagate`
- `test/propagate/DropoutRegularisation.ts` — 13 tests covering config, unit
  behaviour, and training integration

## Evidence

All 4529 tests pass including 13 new dropout-specific tests.

## Test Plan

- **Config tests**: Verify default (0), clamping (negative/over), and
  preservation of valid values
- **Unit tests**: Verify `applyDropout()` zeroes hidden neurons, scales kept
  neurons by 1/(1-p), and leaves input/output neurons untouched
- **Boundary tests**: Rate 0 and rate 1 are no-ops
- **Integration tests**: Training with dropout completes without errors and
  produces valid finite outputs at inference
- **Inference determinism**: After training with dropout, inference produces
  identical results on repeated calls (no dropout applied)
- **Coexistence**: Dropout config works alongside `sparseRatio` and L1/L2 weight
  regularisation
