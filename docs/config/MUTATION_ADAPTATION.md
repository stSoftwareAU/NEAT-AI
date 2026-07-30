# 🎛️ Mutation adaptation

Adaptive mutation, plateau detection, stability adaptation, MCMC (Markov Chain
Monte Carlo) acceptance, and per-creature hyperparameter evolution all adjust
how mutations are applied and accepted. They share a common goal: keep
exploration alive when the population stagnates, and tighten exploitation when
fitness improves.

```ts
import { createNeatConfig } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  adaptiveMutationThresholds: {
    medium: 100,
    large: 300,
    largeTopologyWeight: 0.1,
  },
  plateauDetection: { enabled: true },
  stabilityAdaptation: { enabled: true },
  mcmc: { enabled: true, initialTemperature: 1.0, coolingRate: 0.995 },
  hyperparameterEvolution: { enabled: true },
});
```

## 🎚️ Adaptive mutation thresholds

Controls mutation strategy based on creature size. Large creatures have massive
search spaces where structural mutations (`ADD_NODE`, `ADD_CONNECTION`) rarely
improve fitness.

Pass as `adaptiveMutationThresholds` in options.

| Option                | Type      | Default | Description                                                   |
| --------------------- | --------- | ------- | ------------------------------------------------------------- |
| `medium`              | `integer` | `100`   | Neuron count threshold for medium creatures (min: 1)          |
| `large`               | `integer` | `300`   | Neuron count threshold for large creatures (min: 1)           |
| `largeTopologyWeight` | `number`  | `0.1`   | Weight factor for topology mutations in large creatures (0–1) |

**Behaviour by creature size:**

- **Small** (< medium neurons): Normal topology mutation rates.
- **Medium** (>= medium, < large): Reduced topology expansion.
- **Large** (>= large): Focus on `MOD_WEIGHT` and `MOD_BIAS`; topology mutations
  weighted by `largeTopologyWeight` (default 10% chance).

**Validation:** `large` must be greater than `medium`.

## 📉 Plateau detection

Detects fitness stagnation and applies responses to escape local optima.
Disabled by default.

Pass as `plateauDetection` in options.

| Option                          | Type      | Default | Description                                             |
| ------------------------------- | --------- | ------- | ------------------------------------------------------- |
| `enabled`                       | `boolean` | `false` | Enable plateau detection                                |
| `windowSize`                    | `integer` | `10`    | Generations considered for improvement rate (min: 1)    |
| `minImprovementRate`            | `number`  | `0.001` | Minimum improvement rate to avoid plateau status (0–1)  |
| `rapidImprovementRate`          | `number`  | `0.01`  | Threshold for "rapid improvement" status (0–1)          |
| `responseMutationMultiplier`    | `number`  | `2.0`   | Mutation rate multiplier when on a plateau (min: 1)     |
| `responseImprovementMultiplier` | `number`  | `0.8`   | Mutation rate multiplier during rapid improvement (0–1) |

**Validation:** `rapidImprovementRate` must be greater than
`minImprovementRate`.

## 🧪 Stability adaptation

Adapts mutation rates based on validation stability, tracking mutation outcomes
per creature and adjusting strategies for brittle offspring. Disabled by
default.

Pass as `stabilityAdaptation` in options.

| Option                                | Type      | Default | Description                                               |
| ------------------------------------- | --------- | ------- | --------------------------------------------------------- |
| `enabled`                             | `boolean` | `false` | Enable stability-based adaptation                         |
| `stabilityWindowSize`                 | `integer` | `20`    | Rolling window size for tracking outcomes (min: 1)        |
| `brittlenessThreshold`                | `number`  | `0.3`   | Fraction of brittle mutations triggering adjustment (0–1) |
| `brittleReductionFactor`              | `number`  | `0.5`   | Mutation rate reduction for brittle creatures (0–1)       |
| `stableBoostFactor`                   | `number`  | `1.3`   | Mutation rate boost for stable creatures (min: 1)         |
| `stableBoostThreshold`                | `number`  | `0.85`  | Stability rate threshold for boost (0–1)                  |
| `selectionStabilityWeight`            | `number`  | `0.2`   | Weight of stability in parent selection (0–1)             |
| `adaptiveSelectionWeight`             | `boolean` | `false` | Adapt selection weight based on population brittleness    |
| `topologyMutationReductionForBrittle` | `number`  | `0.3`   | Topology mutation weight for brittle creatures (0–1)      |
| `trackPerMutationType`                | `boolean` | `false` | Track and adapt per mutation type                         |

## 🎲 MCMC acceptance criterion

Issue #2199: Markov Chain Monte Carlo (MCMC) acceptance applies the
[Metropolis–Hastings](https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm)
criterion to mutation acceptance. Instead of unconditionally accepting all
mutations, worse-fitness moves are accepted with a probability that decreases as
temperature cools. This enables the population to escape local optima early in
evolution and converge to precise solutions later.

The acceptance probability follows:

```
P(accept) = min(1, exp(-deltaCost / temperature))
```

Temperature follows an exponential cooling schedule with adaptive tuning (Issue
#2201) that adjusts temperature toward the theoretically optimal acceptance rate
of ~23.4% (Roberts et al. 1997).

Pass as `mcmc` in options.

| Option                 | Type                            | Default      | Description                                                                                                                                               |
| ---------------------- | ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`              | `boolean`                       | `false`      | Whether MCMC acceptance is active                                                                                                                         |
| `initialTemperature`   | `number`                        | `1.0`        | Starting temperature for Metropolis–Hastings acceptance                                                                                                   |
| `minTemperature`       | `number`                        | `0.01`       | Floor temperature to prevent acceptance probability reaching zero                                                                                         |
| `coolingRate`          | `number`                        | `0.995`      | Multiplicative cooling factor applied per generation                                                                                                      |
| `targetAcceptanceRate` | `number`                        | `0.234`      | Optimal acceptance rate for high-dimensional MCMC                                                                                                         |
| `adjustmentRate`       | `number`                        | `0.02`       | Rate at which temperature adapts toward the target acceptance rate                                                                                        |
| `toleranceRate`        | `number`                        | `0.05`       | Tolerance band around target rate within which no adjustment occurs                                                                                       |
| `mcmcAdvantageMode`    | `"absolute" \| "groupRelative"` | `"absolute"` | Issue #2527 — DeepSeek V4 GRPO-style group-relative advantage signal. `"groupRelative"` divides the cost delta by the cohort std for scale-invariant M-H. |
| `minCohortSize`        | `number`                        | `4`          | Issue #2527 — minimum species size for `groupRelative` mode                                                                                               |
| `advantageEps`         | `number`                        | `1e-8`       | Issue #2527 — numerical stabiliser added to cohort std before the divide                                                                                  |
| `advantageClip`        | `number`                        | `10`         | Issue #2527 — symmetric clip on the group-relative advantage delta                                                                                        |

**How it works:**

- **Improving mutations** (lower cost) are always accepted.
- **Worsening mutations** are accepted with probability
  `exp(-deltaCost / temperature)`.
- **Topology mutations** (add/remove nodes or connections) are always accepted
  unconditionally, since discrete structural changes do not lend themselves to
  continuous cost comparison.
- **Adaptive tuning** (Issue #2201): after each generation, the smoothed
  acceptance rate is compared to the target. If acceptance is too high the
  temperature decreases; if too low it increases.

> [!TIP]
> MCMC works well alongside plateau detection. Plateau detection adjusts _how
> much_ mutation happens, while MCMC temperature adjusts _which_ mutations
> stick. Enable both for a robust exploration/exploitation balance.

## 🧬 Per-creature hyperparameter evolution

Issue #1863: Instead of using fixed hyperparameters for the entire population,
each creature carries its own learning rate, mutation rates, and regularisation
strength. These evolve alongside topology and weights — creatures whose
hyperparameters suit the problem achieve higher fitness and propagate their
settings to offspring.

Pass as `hyperparameterEvolution` in options.

### Bounds

| Option                      | Type      | Default  | Description                                                 |
| --------------------------- | --------- | -------- | ----------------------------------------------------------- |
| `enabled`                   | `boolean` | `false`  | Whether per-creature hyperparameter evolution is active     |
| `minLearningRate`           | `number`  | `0.0001` | Lower bound for per-creature learning rate                  |
| `maxLearningRate`           | `number`  | `0.1`    | Upper bound for per-creature learning rate                  |
| `minWeightPerturbation`     | `number`  | `0.1`    | Lower bound for weight perturbation scale                   |
| `maxWeightPerturbation`     | `number`  | `2.0`    | Upper bound for weight perturbation scale                   |
| `maxRegularisationStrength` | `number`  | `0.1`    | Upper bound for L1/L2 regularisation strength               |
| `mutationStdDev`            | `number`  | `0.1`    | Standard deviation for Gaussian mutation of hyperparameters |

### Per-creature hyperparameters

Each creature evolves these values within the configured bounds:

| Hyperparameter             | Default | Description                                        |
| -------------------------- | ------- | -------------------------------------------------- |
| `learningRate`             | `0.01`  | Backpropagation learning rate                      |
| `addNeuronRate`            | `0.1`   | Probability of adding a neuron during mutation     |
| `addConnectionRate`        | `0.2`   | Probability of adding a connection during mutation |
| `weightPerturbationScale`  | `1.0`   | Weight perturbation magnitude scaling factor       |
| `l1RegularisationStrength` | `0`     | L1 regularisation strength for backpropagation     |
| `l2RegularisationStrength` | `0`     | L2 regularisation strength for backpropagation     |

## 👀 See also

- [Core evolution parameters](./CORE_EVOLUTION.md) — base mutation rates that
  these adaptations modulate.
- [Regularisation](./REGULARISATION.md) — weight/bias regularisation and output
  range constraints.
- [Population sizing](./POPULATION.md) — adaptive population sizing pairs
  naturally with plateau detection.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — when MCMC and plateau
  detection are worth the per-generation overhead.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
