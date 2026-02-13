# Configuration Guide

This guide documents all NEAT-AI configuration options, their default values,
and when to adjust them. Configuration is passed via `NeatOptionsInput` to
`createNeatConfig()`, which validates, parses, and freezes the result into a
read-only `NeatConfig`.

Numeric options accept `number | string` so values can be passed directly from
CLI arguments or environment variables without pre-parsing.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Core Evolution Parameters](#core-evolution-parameters)
- [Training Parameters](#training-parameters)
- [Discovery Parameters](#discovery-parameters)
- [Discovery Replay Parameters](#discovery-replay-parameters)
- [Discovery Caching Parameters](#discovery-caching-parameters)
- [Adaptive Mutation Thresholds](#adaptive-mutation-thresholds)
- [Plateau Detection](#plateau-detection)
- [Stability Adaptation](#stability-adaptation)
- [Weight Regularisation](#weight-regularisation)
- [Bias Regularisation](#bias-regularisation)
- [Ensemble Diversity](#ensemble-diversity)
- [Quantum Step](#quantum-step)
- [Fine-Tune Population](#fine-tune-population)
- [Logging and Reproducibility](#logging-and-reproducibility)
- [Validation Rules](#validation-rules)
- [Recipes](#recipes)

---

## Quick Reference

### Core Evolution

| Option                            | Type       | Default                         | Description                                                  |
| --------------------------------- | ---------- | ------------------------------- | ------------------------------------------------------------ |
| `costName`                        | `CostName` | `"MSE"`                         | Cost/fitness function name                                   |
| `populationSize`                  | `integer`  | `50`                            | Target population size (min: 2)                              |
| `iterations`                      | `integer`  | `MAX_SAFE_INTEGER`              | Maximum generations to evolve                                |
| `targetError`                     | `number`   | `0.05`                          | Stop when error falls below this (0–1)                       |
| `mutationRate`                    | `number`   | `0.3`                           | Probability of mutating a gene (>0.001)                      |
| `mutationAmount`                  | `integer`  | `1`                             | Number of changes per gene during mutation (min: 1)          |
| `elitism`                         | `integer`  | `1`                             | Top-performing individuals retained each generation (min: 1) |
| `costOfGrowth`                    | `number`   | `0.0000001`                     | Penalty per structural addition (min: 0)                     |
| `trainingSampleRate`              | `number`   | `1`                             | Fraction of data used for training (0.0001–1)                |
| `trainPerGen`                     | `integer`  | `1`                             | Training sessions per generation (min: 0)                    |
| `trainingBatchSize`               | `integer`  | `100`                           | Observations per training batch (min: 1)                     |
| `dataSetPartitionBreak`           | `integer`  | `2000`                          | Records per dataset file (min: 1)                            |
| `maxConns`                        | `integer`  | `MAX_SAFE_INTEGER`              | Maximum connections (min: 1)                                 |
| `maximumNumberOfNodes`            | `integer`  | `MAX_SAFE_INTEGER`              | Maximum neurons (min: 1)                                     |
| `timeoutMinutes`                  | `integer`  | `0`                             | Maximum training time in minutes (0 = unlimited)             |
| `threads`                         | `integer`  | `navigator.hardwareConcurrency` | Worker threads (min: 1)                                      |
| `feedbackLoop`                    | `boolean`  | `false`                         | Enable recurrent connections                                 |
| `debug`                           | `boolean`  | `false`                         | Enable debug mode (slower)                                   |
| `verbose`                         | `boolean`  | `false`                         | Enable verbose logging                                       |
| `creativeThinkingConnectionCount` | `integer`  | `1`                             | New links during creative thinking phase                     |
| `geneticCompatibilityThreshold`   | `number`   | `0.3`                           | Speciation distance threshold (0–1)                          |
| `sparseRatio`                     | `number`   | `random * random`               | Fraction of neurons selected for sparse activation (0–1)     |
| `globalBreedingRate`              | `number`   | `random`                        | Ratio of cross-species vs within-species breeding (0–1)      |

### Adjustment Scales

| Option                         | Type     | Default | Description                                               |
| ------------------------------ | -------- | ------- | --------------------------------------------------------- |
| `maximumBiasAdjustmentScale`   | `number` | `1`     | Maximum bias adjustment per training iteration (min: 0)   |
| `maximumWeightAdjustmentScale` | `number` | `1`     | Maximum weight adjustment per training iteration (min: 0) |

### Discovery

| Option                            | Type      | Default   | Description                                                         |
| --------------------------------- | --------- | --------- | ------------------------------------------------------------------- |
| `discoverySampleRate`             | `number`  | `0.2`     | Fraction of records sampled for structural analysis (-1 to disable) |
| `discoveryRecordTimeOutMinutes`   | `number`  | `5`       | Maximum minutes for the recording phase                             |
| `discoveryAnalysisTimeoutMinutes` | `number`  | `10`      | Maximum minutes for the analysis phase (0.05–60)                    |
| `discoveryBatchSize`              | `integer` | `128`     | Observations per discovery promise                                  |
| `discoveryBufferSize`             | `number`  | `0`       | Read buffer size in bytes (0 = default)                             |
| `discoveryRustFlushRecords`       | `integer` | `4096`    | Records accumulated before flushing to Rust                         |
| `discoveryRustFlushBytes`         | `number`  | `~50 MiB` | Payload size threshold before flushing                              |
| `discoveryMaxNeurons`             | `integer` | `6`       | Maximum neurons analysed per discovery iteration                    |
| `discoveryDrainEveryNBatches`     | `integer` | `10`      | Drain promise chains every N batches                                |

### Discovery Replay

| Option                           | Type      | Default                                          | Description                                        |
| -------------------------------- | --------- | ------------------------------------------------ | -------------------------------------------------- |
| `discoveryReplayMaxSingles`      | `integer` | `max(2 * threads, 10)`                           | Maximum cached candidates to re-score individually |
| `discoveryReplayMaxPairwise`     | `integer` | `10`                                             | Maximum candidates for pairwise replay             |
| `discoveryReplayMaxTriples`      | `integer` | `8`                                              | Maximum candidates for triple replay               |
| `discoveryReplayTimeoutMinutes`  | `number`  | `5`                                              | Maximum minutes for replay operations              |
| `discoveryReplayMinTimeMinutes`  | `number`  | `1`                                              | Minimum remaining time required to start replay    |
| `discoveryReplayConcurrency`     | `integer` | `threads` (or `max(cores, 8)` if verify enabled) | Bounded concurrency for replay scoring             |
| `discoveryReplayVerifyScores`    | `boolean` | `false`                                          | Verify replay scores against current dataset       |
| `discoveryReplayRescoreBaseline` | `boolean` | `false` (`true` when verify enabled)             | Report baseline score drift                        |
| `discoveryReplayDiagnostics`     | `boolean` | `false`                                          | Record timing diagnostics for replay               |

### Discovery Min Candidates Per Category

| Option            | Type      | Default | Description                                       |
| ----------------- | --------- | ------- | ------------------------------------------------- |
| `addNeurons`      | `integer` | `1`     | Minimum candidates for add-neurons category       |
| `addSynapses`     | `integer` | `1`     | Minimum candidates for add-synapses category      |
| `changeSquash`    | `integer` | `1`     | Minimum candidates for change-squash category     |
| `removeLowImpact` | `integer` | `3`     | Minimum candidates for remove-low-impact category |

---

## Core Evolution Parameters

### `populationSize`

**Default: 50** | Type: integer | Min: 2

The number of creatures (neural networks) in the population. Larger populations
explore more of the search space but consume more memory and compute per
generation.

- **Small (10–30):** Fast prototyping, quick iteration
- **Medium (50–100):** General-purpose training
- **Large (200+):** Production runs where solution quality matters more than
  speed

### `iterations`

**Default: MAX_SAFE_INTEGER** | Type: integer | Min: 0

Maximum number of generations to evolve. Combined with `targetError` and
`timeoutMinutes`, provides three independent stopping conditions. Any condition
reached first will stop evolution.

### `targetError`

**Default: 0.05** | Type: number | Range: 0–1

Evolution stops when the best creature's error falls below this threshold. Lower
values demand higher accuracy but may require significantly more generations.

### `mutationRate`

**Default: 0.3** | Type: number | Min: >0.001

Probability of applying a mutation to each gene. Higher rates increase
exploration but may disrupt good solutions. The plateau detection and stability
adaptation systems can dynamically adjust this during evolution.

### `mutationAmount`

**Default: 1** | Type: integer | Min: 1

Number of changes applied per gene during a single mutation event. Higher values
create more dramatic changes per generation.

### `elitism`

**Default: 1** | Type: integer | Min: 1

Number of top-performing creatures guaranteed to survive into the next
generation unchanged. Ensures the best solution found so far is never lost.

### `costOfGrowth`

**Default: 0.0000001 (1e-7)** | Type: number | Min: 0

Penalty applied to creatures for structural complexity. Each new synapse costs 1
× costOfGrowth; each new neuron costs approximately 3 × costOfGrowth (two
synapses plus the neuron body). This biases evolution towards simpler networks
when accuracy is comparable.

Set to `0` to disable the growth penalty entirely.

### `costName`

**Default: "MSE"** | Type: CostName

The cost (fitness) function used to evaluate creatures. Common options include
`"MSE"` (mean squared error) and others defined in `src/costs/`.

### `trainingSampleRate`

**Default: 1** | Type: number | Range: 0.0001–1

Fraction of the training dataset used in each training iteration. Values below
1.0 enable stochastic training, which can improve generalisation and speed up
each generation at the cost of noisier fitness signals.

### `feedbackLoop`

**Default: false** | Type: boolean

Enables recurrent (feedback) connections, allowing the network to maintain
internal state across activations. Required for time-series tasks. When
disabled, the network operates in forward-only mode.

**Important:** When `feedbackLoop` is `true`, `disableRandomSamples` must also
be `true` (this is enforced by validation).

### `geneticCompatibilityThreshold`

**Default: 0.3** | Type: number | Range: 0–1

Controls how different two creatures must be to belong to different species.
Lower values create more species (finer-grained niching); higher values create
fewer, broader species.

### `sparseRatio`

**Default: random × random** | Type: number | Range: 0–1

Fraction of neurons selected for sparse activation. Randomised by default so
each creature gets a different sparsity level, promoting diversity.

### `globalBreedingRate`

**Default: random** | Type: number | Range: 0–1

Controls the balance between cross-species breeding and within-species breeding.
Higher values favour more cross-species mating. Randomised by default to
maintain population diversity.

---

## Training Parameters

These parameters control backpropagation training within each generation.

### `trainPerGen`

**Default: 1** | Type: integer | Min: 0

Number of training sessions applied per generation. Set to `0` to disable
backpropagation entirely and rely solely on evolutionary selection.

### `trainingBatchSize`

**Default: 100** | Type: integer | Min: 1

Number of observations per training batch during backpropagation.

### `maximumBiasAdjustmentScale`

**Default: 1** | Type: number | Min: 0

Maximum amount by which a bias can be adjusted in one training iteration. Higher
values allow more aggressive bias updates.

### `maximumWeightAdjustmentScale`

**Default: 1** | Type: number | Min: 0

Maximum amount by which a weight can be adjusted in one training iteration.
Higher values allow more aggressive weight updates.

### `timeoutMinutes`

**Default: 0 (unlimited)** | Type: integer | Min: 0

Maximum total minutes for the training loop. Set to `0` for unlimited. Useful
for production environments where runs must complete within a time budget.

---

## Discovery Parameters

Discovery uses the Rust FFI extension for GPU-accelerated structural analysis.
It proposes structural improvements (add neurons, add synapses, change
activation functions, remove low-impact elements) based on error patterns.

Set `discoverySampleRate` to `-1` to disable discovery entirely.

### `discoverySampleRate`

**Default: 0.2 (20%)** | Type: number

Fraction of training records sampled for structural analysis. Higher values give
the analysis engine more data to work with, improving candidate quality at the
cost of longer recording time.

### `discoveryRecordTimeOutMinutes`

**Default: 5** | Type: number | Min: 0

Maximum minutes allocated to the recording phase before discovery advances to
analysis. At approximately 700 records/sec, 5 minutes allows recording around
210,000 samples.

### `discoveryAnalysisTimeoutMinutes`

**Default: 10** | Type: number | Range: 0.05–60

Maximum minutes allocated to the analysis phase (after recording). The Rust
library requires at least 3 seconds (0.05 minutes).

### `discoveryMaxNeurons`

**Default: 6** | Type: integer | Min: 0

Maximum number of neurons analysed per discovery iteration. Balances
thoroughness with speed. Set to `0` to skip neuron analysis.

### `discoveryBatchSize`

**Default: 128** | Type: integer | Min: 1

Number of observations per discovery promise batch.

### `discoveryRustFlushRecords`

**Default: 4096** | Type: integer | Min: 1

Number of records accumulated in memory before flushing to the Rust recorder.
Lower values reduce peak memory at the cost of more frequent I/O.

### `discoveryRustFlushBytes`

**Default: ~50 MiB (52,428,800 bytes)** | Type: number | Min: 1

Estimated payload size threshold before flushing a Rust discovery chunk.
Prevents V8 from hitting JSON.stringify() maximum string length limits.

### `discoveryDrainEveryNBatches`

**Default: 10** | Type: integer | Min: 1

Drain promise chains every N batches during discovery recording to prevent
memory buildup.

---

## Discovery Replay Parameters

When discovery caching is enabled, successful discoveries can be replayed
against newer fittest creatures to re-apply structural improvements.

### `discoveryReplayMaxSingles`

**Default: max(2 × threads, 10)** | Type: integer | Min: 0

Maximum number of cached single candidates to individually re-score during
replay.

### `discoveryReplayMaxPairwise`

**Default: 10** | Type: integer | Min: 0

Maximum number of candidates considered for pairwise combination replay.

### `discoveryReplayMaxTriples`

**Default: 8** | Type: integer | Min: 0

Maximum number of candidates considered for triple combination replay.

### `discoveryReplayTimeoutMinutes`

**Default: 5** | Type: number | Min: 0

Maximum minutes allocated for replay operations. Set to `0` to disable the
replay timeout (not recommended for production).

### `discoveryReplayMinTimeMinutes`

**Default: 1** | Type: number | Min: 0

Minimum remaining evolution time (in minutes) required before starting replay.
If remaining time falls below this, replay is skipped.

### `discoveryReplayVerifyScores`

**Default: false** | Type: boolean

When enabled, replay verifies baseline and candidate scores against the current
dataset directory and only reports confirmed improvements.

### `discoveryReplayConcurrency`

**Default: threads (or max(cores, 8) when verify is enabled)** | Type: integer |
Min: 1

Bounded concurrency for replay scoring operations.

---

## Discovery Caching Parameters

These optional parameters enable caching of discovery results across evolution
runs.

| Option                     | Type     | Default                       | Description                                 |
| -------------------------- | -------- | ----------------------------- | ------------------------------------------- |
| `discoveryCacheDir`        | `string` | `undefined`                   | Base directory for discovery caching        |
| `discoveryFailureCacheDir` | `string` | `{discoveryCacheDir}/failure` | Directory for caching failed candidates     |
| `discoverySuccessCacheDir` | `string` | `{discoveryCacheDir}/success` | Directory for caching successful candidates |

**Important:** Delete the cache directory when the training dataset changes
materially to avoid replaying stale signals.

---

## Adaptive Mutation Thresholds

Controls mutation strategy based on creature size. Large creatures have massive
search spaces where structural mutations (ADD_NODE, ADD_CONNECTION) rarely
improve fitness.

Pass as `adaptiveMutationThresholds` in options.

| Option                | Type      | Default | Description                                                   |
| --------------------- | --------- | ------- | ------------------------------------------------------------- |
| `medium`              | `integer` | `100`   | Neuron count threshold for medium creatures (min: 1)          |
| `large`               | `integer` | `300`   | Neuron count threshold for large creatures (min: 1)           |
| `largeTopologyWeight` | `number`  | `0.1`   | Weight factor for topology mutations in large creatures (0–1) |

**Behaviour by creature size:**

- **Small** (< medium neurons): Normal topology mutation rates
- **Medium** (>= medium, < large): Reduced topology expansion
- **Large** (>= large): Focus on MOD_WEIGHT and MOD_BIAS; topology mutations
  weighted by `largeTopologyWeight` (default 10% chance)

**Validation:** `large` must be greater than `medium`.

---

## Plateau Detection

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

---

## Stability Adaptation

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

---

## Weight Regularisation

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

---

## Bias Regularisation

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

---

## Ensemble Diversity

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

---

## Quantum Step

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

---

## Fine-Tune Population

Dynamically adjusts the fine-tuning population size based on recent success
rates. When fine-tuning produces improvements, more resources are allocated.

Pass as `fineTunePopulation` in options.

| Option                   | Type      | Default | Description                                             |
| ------------------------ | --------- | ------- | ------------------------------------------------------- |
| `minPopulationFraction`  | `number`  | `0.1`   | Minimum fraction of population for fine-tuning (0–1)    |
| `maxPopulationFraction`  | `number`  | `0.4`   | Maximum fraction of population for fine-tuning (0–1)    |
| `basePopulationFraction` | `number`  | `0.2`   | Starting fraction before success data exists (0–1)      |
| `successRateWindow`      | `integer` | `10`    | Recent generations considered for success rate (min: 1) |

**Validation:**

- `maxPopulationFraction` must be >= `minPopulationFraction`
- `basePopulationFraction` must be >= `minPopulationFraction`
- `basePopulationFraction` must be <= `maxPopulationFraction`

---

## Logging and Reproducibility

### `log`

**Default: 0 (1 when verbose is true)** | Type: integer | Min: 0

Output training status every N iterations. Set to `1` to log every iteration,
`0` to disable periodic logging.

### `logLevel`

**Default: "info"** | Type: LogLevel

Log level filter for the default console logger. Ignored when a custom `logger`
is provided.

### `logger`

**Default: console logger at "info" level** | Type: Logger

Custom logger instance for routing NEAT-AI log output to external logging
systems.

### `seed`

**Default: undefined (uses Math.random())** | Type: number

Seed for reproducible random number generation. When provided, all stochastic
operations (mutation, selection, breeding, shuffling) use a deterministic
xoshiro256** PRNG. Two runs with the same seed and configuration produce
identical results.

### `rng`

**Default: undefined** | Type: RandomNumberGenerator

Custom random number generator instance. Takes precedence over `seed` when both
are provided.

---

## Validation Rules

`createNeatConfig()` validates all parameters and throws on invalid
configurations. Key rules:

1. **feedbackLoop + disableRandomSamples:** When `feedbackLoop` is `true`,
   `disableRandomSamples` must also be `true`.

2. **Adaptive mutation thresholds:** `large` must be greater than `medium`.

3. **Plateau detection:** `rapidImprovementRate` must be greater than
   `minImprovementRate`.

4. **Quantum step:** `maxStep` must be >= `minStep`.

5. **Fine-tune population:**
   - `maxPopulationFraction` >= `minPopulationFraction`
   - `basePopulationFraction` >= `minPopulationFraction`
   - `basePopulationFraction` <= `maxPopulationFraction`

6. **Discovery focus neuron UUIDs:** Must be an array of non-empty strings.

7. **Range constraints:** Many numeric options have minimum/maximum bounds
   enforced by `parseNumber()`. See the quick reference tables for specific
   ranges.

---

## Recipes

### Fast Prototyping

Small population, quick iterations to validate an approach:

```ts
const config = createNeatConfig({
  populationSize: 10,
  iterations: 50,
  targetError: 0.1,
  trainPerGen: 1,
  discoverySampleRate: -1, // Disable discovery for speed
  timeoutMinutes: 5,
});
```

### Production Training

Large population with discovery enabled for thorough structural optimisation:

```ts
const config = createNeatConfig({
  populationSize: 200,
  iterations: 10_000,
  targetError: 0.01,
  trainPerGen: 2,
  discoverySampleRate: 0.3,
  discoveryRecordTimeOutMinutes: 10,
  discoveryAnalysisTimeoutMinutes: 20,
  timeoutMinutes: 120,
  discoveryCacheDir: "./discovery-cache",
  plateauDetection: {
    enabled: true,
    windowSize: 15,
    responseMutationMultiplier: 2.5,
  },
  stabilityAdaptation: {
    enabled: true,
  },
  ensembleDiversity: {
    enabled: true,
    diversityWeight: 0.2,
  },
});
```

### Research / Reproducibility

Seeded PRNG for deterministic, reproducible experiments:

```ts
const config = createNeatConfig({
  seed: 42,
  populationSize: 50,
  iterations: 1_000,
  targetError: 0.05,
  // Fixed values instead of random defaults
  sparseRatio: 0.5,
  globalBreedingRate: 0.5,
});
```

### Time-Series / Recurrent

Enable feedback loops for sequential data:

```ts
const config = createNeatConfig({
  feedbackLoop: true,
  disableRandomSamples: true, // Required when feedbackLoop is true
  populationSize: 50,
  iterations: 500,
  targetError: 0.05,
});
```

### Minimal Complexity

Favour simpler networks with aggressive growth penalties:

```ts
const config = createNeatConfig({
  costOfGrowth: 0.001,
  maxConns: 50,
  maximumNumberOfNodes: 20,
  populationSize: 50,
  targetError: 0.05,
});
```
