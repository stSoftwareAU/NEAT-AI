# ⚖️ Regularisation, diversity, and step sizing

This page covers the configuration knobs that constrain mutation magnitudes,
diversify the population, bound output ranges, and tune the memetic step size
during fine-tuning. They are independent subsystems but are grouped here because
they all reshape the optimisation landscape rather than the NEAT (NeuroEvolution
of Augmenting Topologies) outer loop itself.

## ⚖️ Weight regularisation

Prevents extreme weight values during mutation that cause brittleness. **Enabled
by default.**

Pass as `weightRegularisation` in options.

| Option               | Type      | Default | Description                                        |
| -------------------- | --------- | ------- | -------------------------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable weight regularisation                       |
| `maxAbsoluteWeight`  | `number`  | `100`   | Maximum absolute weight value (min: 0.001)         |
| `maxWeightChange`    | `number`  | `10`    | Maximum weight change per mutation (min: 0.001)    |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength (0–1)                   |
| `preferSmallChanges` | `boolean` | `true`  | Bias mutation distribution towards smaller changes |
| `smallChangeScale`   | `number`  | `0.5`   | Scale factor for small change preference (0–1)     |

## ⚖️ Bias regularisation

Prevents extreme bias values during mutation that cause exploding activations.
**Enabled by default.** Mirrors the weight regularisation approach.

Pass as `biasRegularisation` in options.

| Option               | Type      | Default | Description                                        |
| -------------------- | --------- | ------- | -------------------------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable bias regularisation                         |
| `maxAbsoluteBias`    | `number`  | `100`   | Maximum absolute bias value (min: 0.001)           |
| `maxBiasChange`      | `number`  | `10`    | Maximum bias change per mutation (min: 0.001)      |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength (0–1)                   |
| `preferSmallChanges` | `boolean` | `true`  | Bias mutation distribution towards smaller changes |
| `smallChangeScale`   | `number`  | `0.5`   | Scale factor for small change preference (0–1)     |

## 🌈 Ensemble diversity

Encourages species diversity to avoid over-reliance on "brilliant but brittle"
high-performers. Disabled by default.

Pass as `ensembleDiversity` in options.

| Option                          | Type      | Default | Description                                                 |
| ------------------------------- | --------- | ------- | ----------------------------------------------------------- |
| `enabled`                       | `boolean` | `false` | Enable ensemble diversity scoring                           |
| `diversityWeight`               | `number`  | `0.15`  | Weight of diversity in fitness adjustment (0–1)             |
| `weightVarianceWeight`          | `number`  | `0.4`   | Weight for weight variance metric (0–1)                     |
| `squashEntropyWeight`           | `number`  | `0.3`   | Weight for squash entropy metric (0–1)                      |
| `topologyDiversityWeight`       | `number`  | `0.3`   | Weight for topology diversity metric (0–1)                  |
| `protectDiverseLowPerformers`   | `boolean` | `false` | Protect diverse creatures from culling                      |
| `diversityProtectionThreshold`  | `number`  | `0.7`   | Diversity threshold for culling protection (0–1)            |
| `crossSpeciesBreedingThreshold` | `number`  | `0.2`   | Diversity threshold triggering cross-species breeding (0–1) |
| `lowDiversityThreshold`         | `number`  | `0.3`   | Threshold for considering a species low-diversity (0–1)     |
| `diverseParentPreferenceWeight` | `number`  | `0.2`   | Weight for genetic distance in parent selection (0–1)       |

## 📐 Output range constraints

Issue #1620: Constrain evolution outputs to domain-specific ranges. When
`outputRanges` is set, creatures whose outputs fall outside the specified
`[min, max]` range receive a quadratic fitness penalty proportional to the
excess, normalised by the range span.

```ts
const config = createNeatConfig({
  outputRanges: [
    { min: -0.35, max: 0.35 },
    { min: -0.50, max: 0.50, penaltyWeight: 2 },
  ],
});
```

Each element maps to one output neuron, in order. Outputs without a
corresponding entry are unconstrained.

| Field           | Default | Min | Description                                           |
| --------------- | ------- | --- | ----------------------------------------------------- |
| `min`           | —       | —   | Minimum expected output value (inclusive)             |
| `max`           | —       | —   | Maximum expected output value (inclusive, must ≥ min) |
| `penaltyWeight` | `1.0`   | `0` | Multiplier for the out-of-range penalty               |

**Penalty formula** (per output, per record):

```
penalty = penaltyWeight × (excess / rangeSpan)²
```

where `excess = max(0, min - value) + max(0, value - max)` and
`rangeSpan = max - min`. The penalty is added to the evaluation error before
averaging, so it directly reduces the creature's fitness score.

When `outputRanges` is not specified (or empty), existing behaviour is
completely unchanged.

## ⚛️ Quantum step

Controls adaptive step sizing during memetic fine-tuning. Larger steps are used
when far from the optimum; smaller steps when fine-tuning near convergence.

Pass as `quantumStep` in options.

| Option       | Type     | Default            | Description                                      |
| ------------ | -------- | ------------------ | ------------------------------------------------ |
| `minStep`    | `number` | `0.0000001` (1e-7) | Minimum quantum step size                        |
| `maxStep`    | `number` | `0.001` (1e-3)     | Maximum quantum step size                        |
| `errorScale` | `number` | `10`               | Scale factor for error-based adaptation (min: 0) |

The effective step size is calculated as:

```
effectiveStep = baseStep × (1 + errorScale × normalisedError)
```

**Validation:** `maxStep` must be >= `minStep`.

## ✅ Validation rules

- `weightRegularisation.maxAbsoluteWeight` must be at least `0.001`.
- `biasRegularisation.maxAbsoluteBias` must be at least `0.001`.
- `quantumStep.maxStep` must be greater than or equal to `quantumStep.minStep`.
- Each `outputRanges` entry must satisfy `max >= min`.

## 👀 See also

- [Training parameters](./TRAINING.md) — adjustment scales applied per iteration
  during backpropagation.
- [Mutation adaptation](./MUTATION_ADAPTATION.md) — adaptive thresholds and
  per-creature hyperparameter evolution.
- [BACKPROP_ELASTICITY.md](../BACKPROP_ELASTICITY.md) — why minimum-change
  weight updates are preferred and how saturated activations are protected.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — when ensemble diversity is
  worth its evaluation cost.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
