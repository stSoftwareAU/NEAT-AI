# ⚙️ Configuration reference

`NeatOptions` is the primary configuration type for the NEAT (NeuroEvolution of
Augmenting Topologies) algorithm. It is passed to `Creature.evolveDir()`. This
page lists every field plus the optional sub-configuration objects.

> **Acronyms:** API (Application Programming Interface), MCMC (Markov Chain
> Monte Carlo), MSE (Mean Squared Error), L2 (squared-magnitude regularisation),
> ONNX (Open Neural Network Exchange), JSON (JavaScript Object Notation), RNG
> (Random Number Generator), CRISPR (Clustered Regularly Interspaced Short
> Palindromic Repeats).

For prose-level guidance on choosing values, see the long-form
[Configuration Guide](../CONFIGURATION_GUIDE.md). This page is the
field-by-field reference.

## 📦 Exports documented here

- `NeatOptions`, `NeatOptionsInput`
- `OutputRange`, `RequiredOutputRange`, `DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT`,
  `calculateOutputRangePenalty`
- Hyperparameter evolution: `EvolvableHyperparameters`,
  `HyperparameterEvolutionConfig`, `RequiredEvolvableHyperparameters`,
  `RequiredHyperparameterEvolutionConfig`, `DEFAULT_EVOLVABLE_HYPERPARAMETERS`,
  `DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG`
- MCMC: `MCMCConfig`, `RequiredMCMCConfig`, `DiversityAwareMCMCConfig`,
  `RequiredDiversityAwareMCMCConfig`, `DEFAULT_MCMC_CONFIG`,
  `DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG`
- Adaptive population: `AdaptivePopulationConfig`,
  `RequiredAdaptivePopulationConfig`, `DEFAULT_ADAPTIVE_POPULATION_CONFIG`
- Parallel evaluation: `ParallelEvaluationConfig`,
  `RequiredParallelEvaluationConfig`, `DEFAULT_PARALLEL_EVALUATION_CONFIG`
- Data fuzzing: `DataFuzzingConfig`, `RequiredDataFuzzingConfig`,
  `DEFAULT_DATA_FUZZING_CONFIG`
- Disk space: `DiskSpaceConfig`, `RequiredDiskSpaceConfig`,
  `DEFAULT_DISK_SPACE_CONFIG`
- Specialist pipeline: `SpecialistConfig`, `RequiredSpecialistConfig`,
  `SpecialistMode`, `DEFAULT_SPECIALIST_CONFIG`
- Training events: `TrainingEvent`, `TrainingEventCallback`,
  `GenerationCompleteEvent`, `PlateauDetectedEvent`, `DiscoveryCompleteEvent`,
  `MemoryPressureEvent`, `SpeciesAdjustedEvent`
- Logger and RNG: `Logger`, `LogLevel`, `createConsoleLogger`, `getLogger`,
  `setLogger`, `SILENT_LOGGER`, `RandomNumberGenerator`, `createSeededRng`,
  `createUnseededRng`, `getRandomNumberGenerator`, `setRandomNumberGenerator`

## ⚙️ NeatOptions

```typescript
import type { NeatOptions, NeatOptionsInput } from "@stsoftware/neat-ai";
```

`NeatOptionsInput` is identical but accepts `string | number` for numeric fields
(useful for command-line argument parsing).

### 🎯 Core fields

| Field            | Type                  | Default                         | Description                                                |
| ---------------- | --------------------- | ------------------------------- | ---------------------------------------------------------- |
| `costName`       | `CostName`            | `"MSE"`                         | Cost function name                                         |
| `populationSize` | `number`              | `50`                            | Target population size (min: 2)                            |
| `iterations`     | `number`              | `MAX_SAFE_INTEGER`              | Maximum evolution generations                              |
| `targetError`    | `number`              | `0.05`                          | Stop when error falls below this (0–1)                     |
| `mutationRate`   | `number`              | `0.3`                           | Probability of mutation (>0.001)                           |
| `mutationAmount` | `number`              | `1`                             | Number of changes per gene during mutation (min: 1)        |
| `elitism`        | `number`              | `1`                             | Top-performing creatures retained each generation (min: 1) |
| `selection`      | `SelectionInterface`  | Random                          | Selection strategy (randomly chosen each run)              |
| `mutation`       | `MutationInterface[]` | `Mutation.FFW`                  | Allowed mutation types                                     |
| `threads`        | `number`              | `navigator.hardwareConcurrency` | Worker threads for parallel evaluation                     |
| `verbose`        | `boolean`             | `false`                         | Enable debug logging                                       |
| `log`            | `number`              | `0`                             | Log status every N generations (0 = off, 1 if verbose)     |

### 🎓 Training fields

| Field                          | Type     | Default                                | Description                                |
| ------------------------------ | -------- | -------------------------------------- | ------------------------------------------ |
| `trainPerGen`                  | `number` | _auto_ (20% of population, supervised) | Creatures trained per generation           |
| `trainingBatchSize`            | `number` | `100`                                  | Samples per training batch                 |
| `trainingSampleRate`           | `number` | `1.0`                                  | Fraction of data used per training pass    |
| `maximumBiasAdjustmentScale`   | `number` | `1`                                    | Max bias change per backpropagation step   |
| `maximumWeightAdjustmentScale` | `number` | `1`                                    | Max weight change per backpropagation step |
| `sparseRatio`                  | `number` | `random * random`                      | Neuron selection ratio for sparse updates  |

### 🔒 Network constraints

| Field                  | Type      | Default       | Description                           |
| ---------------------- | --------- | ------------- | ------------------------------------- |
| `feedbackLoop`         | `boolean` | `false`       | Enable recurrent connections          |
| `maxConns`             | `number`  | `Infinity`    | Maximum synapses allowed              |
| `maximumNumberOfNodes` | `number`  | `Infinity`    | Maximum hidden neurons allowed        |
| `costOfGrowth`         | `number`  | `0.000_000_1` | Complexity penalty per synapse/neuron |

### 🔬 Discovery fields

| Field                             | Type     | Default | Description                                  |
| --------------------------------- | -------- | ------- | -------------------------------------------- |
| `discoverySampleRate`             | `number` | `0.2`   | Fraction of data for discovery (20%)         |
| `discoveryRecordTimeOutMinutes`   | `number` | `5`     | Minutes for discovery recording phase        |
| `discoveryAnalysisTimeoutMinutes` | `number` | `10`    | Minutes for discovery analysis               |
| `discoveryBatchSize`              | `number` | `128`   | Samples per discovery analysis batch         |
| `discoveryMaxNeurons`             | `number` | `6`     | Max neurons analysed per discovery iteration |

### 🧬 Evolution fields

| Field                             | Type     | Default  | Description                                    |
| --------------------------------- | -------- | -------- | ---------------------------------------------- |
| `timeoutMinutes`                  | `number` | `0`      | Evolution timeout (0 = unlimited)              |
| `focusRate`                       | `number` | `0.25`   | Attention weight for focus list observations   |
| `globalBreedingRate`              | `number` | `random` | Cross-species vs within-species breeding ratio |
| `geneticCompatibilityThreshold`   | `number` | `0.3`    | Genetic distance threshold for speciation      |
| `creativeThinkingConnectionCount` | `number` | `1`      | New connections during creative thinking       |
| `dataSetPartitionBreak`           | `number` | `2000`   | Records per dataset file partition             |

### 🎲 Reproducibility fields

| Field  | Type                    | Default     | Description                            |
| ------ | ----------------------- | ----------- | -------------------------------------- |
| `seed` | `number`                | `undefined` | PRNG seed for deterministic evolution  |
| `rng`  | `RandomNumberGenerator` | `undefined` | Custom RNG instance (overrides `seed`) |

---

## 🗂️ Sub-configuration objects

Each optional sub-config has a `Required*` companion type used internally after
defaults are applied.

### `plateauDetection` — PlateauDetectionConfig

| Field                           | Type      | Default | Description                                       |
| ------------------------------- | --------- | ------- | ------------------------------------------------- |
| `enabled`                       | `boolean` | `false` | Enable plateau detection                          |
| `windowSize`                    | `number`  | `10`    | Generations in the improvement window             |
| `minImprovementRate`            | `number`  | `0.001` | Minimum improvement rate (0.1%)                   |
| `rapidImprovementRate`          | `number`  | `0.01`  | Threshold for "rapid" improvement (1%)            |
| `responseMutationMultiplier`    | `number`  | `2.0`   | Mutation rate multiplier on plateau               |
| `responseImprovementMultiplier` | `number`  | `0.8`   | Mutation rate multiplier during rapid improvement |

### `stabilityAdaptation` — StabilityAdaptationConfig

| Field                                 | Type      | Default | Description                                       |
| ------------------------------------- | --------- | ------- | ------------------------------------------------- |
| `enabled`                             | `boolean` | `false` | Enable stability-based adaptation                 |
| `stabilityWindowSize`                 | `number`  | `20`    | Window for stability measurement                  |
| `brittlenessThreshold`                | `number`  | `0.3`   | Threshold below which a creature is "brittle"     |
| `brittleReductionFactor`              | `number`  | `0.5`   | Mutation reduction for brittle creatures          |
| `stableBoostFactor`                   | `number`  | `1.3`   | Mutation boost for stable creatures               |
| `stableBoostThreshold`                | `number`  | `0.85`  | Stability score threshold for boost               |
| `selectionStabilityWeight`            | `number`  | `0.2`   | Weight of stability in selection                  |
| `adaptiveSelectionWeight`             | `boolean` | `false` | Auto-adjust selection weight                      |
| `topologyMutationReductionForBrittle` | `number`  | `0.3`   | Topology mutation reduction for brittle creatures |
| `trackPerMutationType`                | `boolean` | `false` | Track stability per mutation type                 |

### `weightRegularisation` — WeightRegularisationConfig

| Field                | Type      | Default | Description                        |
| -------------------- | --------- | ------- | ---------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable weight regularisation       |
| `maxAbsoluteWeight`  | `number`  | `100`   | Maximum absolute weight value      |
| `maxWeightChange`    | `number`  | `10`    | Maximum weight change per mutation |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength         |
| `preferSmallChanges` | `boolean` | `true`  | Prefer small weight changes        |
| `smallChangeScale`   | `number`  | `0.5`   | Scale for small changes            |

### `biasRegularisation` — BiasRegularisationConfig

| Field                | Type      | Default | Description                      |
| -------------------- | --------- | ------- | -------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable bias regularisation       |
| `maxAbsoluteBias`    | `number`  | `100`   | Maximum absolute bias value      |
| `maxBiasChange`      | `number`  | `10`    | Maximum bias change per mutation |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength       |
| `preferSmallChanges` | `boolean` | `true`  | Prefer small bias changes        |
| `smallChangeScale`   | `number`  | `0.5`   | Scale for small changes          |

### `ensembleDiversity` — EnsembleDiversityConfig

| Field                           | Type      | Default | Description                              |
| ------------------------------- | --------- | ------- | ---------------------------------------- |
| `enabled`                       | `boolean` | `false` | Enable diversity scoring                 |
| `diversityWeight`               | `number`  | `0.15`  | Overall diversity weight in fitness      |
| `weightVarianceWeight`          | `number`  | `0.4`   | Weight variance contribution             |
| `squashEntropyWeight`           | `number`  | `0.3`   | Activation function entropy contribution |
| `topologyDiversityWeight`       | `number`  | `0.3`   | Topology diversity contribution          |
| `protectDiverseLowPerformers`   | `boolean` | `false` | Shield diverse but low-scoring creatures |
| `diversityProtectionThreshold`  | `number`  | `0.7`   | Diversity threshold for protection       |
| `crossSpeciesBreedingThreshold` | `number`  | `0.2`   | Threshold for cross-species breeding     |
| `lowDiversityThreshold`         | `number`  | `0.3`   | Threshold below which diversity is "low" |
| `diverseParentPreferenceWeight` | `number`  | `0.2`   | Preference weight for diverse parents    |

### `quantumStep` — QuantumStepConfig

| Field        | Type     | Default       | Description                   |
| ------------ | -------- | ------------- | ----------------------------- |
| `minStep`    | `number` | `0.000_000_1` | Minimum fine-tuning step size |
| `maxStep`    | `number` | `0.001`       | Maximum fine-tuning step size |
| `errorScale` | `number` | `10`          | Error scaling factor          |

### `fineTunePopulation` — FineTunePopulationConfig

| Field                    | Type     | Default | Description                                 |
| ------------------------ | -------- | ------- | ------------------------------------------- |
| `minPopulationFraction`  | `number` | `0.1`   | Minimum population fraction for fine-tuning |
| `maxPopulationFraction`  | `number` | `0.4`   | Maximum population fraction for fine-tuning |
| `basePopulationFraction` | `number` | `0.2`   | Base population fraction                    |
| `successRateWindow`      | `number` | `10`    | Window for success rate tracking            |

### `adaptiveMutationThresholds` — AdaptiveMutationThresholds

| Field                 | Type     | Default | Description                                            |
| --------------------- | -------- | ------- | ------------------------------------------------------ |
| `medium`              | `number` | `100`   | Synapse count threshold for "medium" creatures         |
| `large`               | `number` | `300`   | Synapse count threshold for "large" creatures          |
| `largeTopologyWeight` | `number` | `0.1`   | Topology mutation weight reduction for large creatures |

### `mcmc` — MCMCConfig

Issue #2199: Markov Chain Monte Carlo (MCMC) temperature-based acceptance for
the Metropolis-Hastings criterion. Worse-fitness moves are accepted with a
probability that decreases as temperature cools, helping the population escape
local optima early and converge later.

```typescript
import { DEFAULT_MCMC_CONFIG } from "@stsoftware/neat-ai";

import type { MCMCConfig, RequiredMCMCConfig } from "@stsoftware/neat-ai";

const options: NeatOptions = {
  mcmc: {
    enabled: true,
    initialTemperature: 1.0,
    coolingRate: 0.995,
  },
};
```

| Field                  | Type      | Default | Description                                                         |
| ---------------------- | --------- | ------- | ------------------------------------------------------------------- |
| `enabled`              | `boolean` | `false` | Whether MCMC acceptance is active                                   |
| `initialTemperature`   | `number`  | `1.0`   | Starting temperature for Metropolis-Hastings acceptance             |
| `minTemperature`       | `number`  | `0.01`  | Floor temperature to prevent acceptance probability reaching zero   |
| `coolingRate`          | `number`  | `0.995` | Multiplicative cooling factor applied per generation                |
| `targetAcceptanceRate` | `number`  | `0.234` | Optimal acceptance rate for high-dimensional MCMC                   |
| `adjustmentRate`       | `number`  | `0.02`  | Rate at which temperature adapts toward the target acceptance rate  |
| `toleranceRate`        | `number`  | `0.05`  | Tolerance band around target rate within which no adjustment occurs |

`DEFAULT_MCMC_CONFIG` is a fully-populated `RequiredMCMCConfig`. Spread it and
override individual fields:

```typescript
const myConfig: MCMCConfig = {
  ...DEFAULT_MCMC_CONFIG,
  enabled: true,
  coolingRate: 0.99, // faster cooling
};
```

**Acceptance behaviour:**

- **Improving mutations** (lower cost) are always accepted.
- **Worsening mutations** are accepted with probability
  `exp(-deltaCost / temperature)`.
- **Topology mutations** (add/remove node or connection, swap nodes, change
  squash) are always accepted unconditionally.
- **Adaptive tuning** (Issue #2201): temperature automatically adjusts toward
  the target acceptance rate each generation.

`DiversityAwareMCMCConfig` and `DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG` extend MCMC
acceptance with population-diversity-aware temperature scaling.

### `outputRange` — OutputRange / RequiredOutputRange

Issue #1620: per-output range constraints. Creatures producing outputs outside
these ranges receive a fitness penalty proportional to the excess. Use
`calculateOutputRangePenalty(creature, ranges)` to compute the penalty manually;
`DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT` is the internal weighting applied during
evolution.

### `hyperparameterEvolution` — HyperparameterEvolutionConfig

Issue #1863: per-creature evolvable hyperparameters (learning rate, mutation
rates, regularisation strength) subject to mutation and crossover.
`DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG` and
`DEFAULT_EVOLVABLE_HYPERPARAMETERS` are the seed values.

### `adaptivePopulation` — AdaptivePopulationConfig

Issue #1863: automatically adjust population size based on diversity metrics and
convergence progress. Defaults via `DEFAULT_ADAPTIVE_POPULATION_CONFIG`.

### `parallelEvaluation` — ParallelEvaluationConfig

Issue #1862: controls topology-aware grouping and concurrency limits for
population fitness evaluation. Topology grouping clusters same-structure
creatures to maximise WASM (WebAssembly) cache hits. Defaults via
`DEFAULT_PARALLEL_EVALUATION_CONFIG`.

### `dataFuzzing` — DataFuzzingConfig

Issue #1900: training data fuzzing adds small random perturbations to prevent
memorisation. Supports Gaussian and uniform noise. Defaults via
`DEFAULT_DATA_FUZZING_CONFIG`.

### `diskSpace` — DiskSpaceConfig

Issue #1703: pre-flight disk-space check during discovery. Defaults via
`DEFAULT_DISK_SPACE_CONFIG`.

### `specialist` — SpecialistConfig

Issue #2530: enable the specialist sub-population pipeline (see
[Evolution API → Specialist Pipeline](EVOLUTION.md#-specialist-pipeline)).
Defaults via `DEFAULT_SPECIALIST_CONFIG`. `SpecialistMode` enumerates the
distillation modes available.

---

## 📡 Training events

```typescript
import type {
  DiscoveryCompleteEvent,
  GenerationCompleteEvent,
  MemoryPressureEvent,
  PlateauDetectedEvent,
  SpeciesAdjustedEvent,
  TrainingEvent,
  TrainingEventCallback,
} from "@stsoftware/neat-ai";
```

Issue #1615: register an `onTrainingEvent: TrainingEventCallback` callback in
`NeatOptions` to receive typed events for generation completion, plateau
detection, discovery outcomes, memory pressure, and species adjustments.

---

## 📝 Logger

Structured logging abstraction. Consumers can inject a custom logger via
`NeatOptions.logger` or call `setLogger()` globally.

```typescript
import {
  createConsoleLogger,
  getLogger,
  setLogger,
  SILENT_LOGGER,
} from "@stsoftware/neat-ai";

import type { Logger, LogLevel } from "@stsoftware/neat-ai";
```

```typescript
interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

type LogLevel = "debug" | "info" | "warn" | "error" | "none";
```

```typescript
const logger = getLogger();
logger.info("Training started");

setLogger(createConsoleLogger("warn")); // Only warn and error
setLogger(SILENT_LOGGER); // Silence all logging

const options: NeatOptions = {
  logger: createConsoleLogger("debug"),
  logLevel: "warn", // or just set the level
};
```

---

## 🎲 Random Number Generator

Reproducible random number generation with optional seeding.

```typescript
import {
  createSeededRng,
  createUnseededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@stsoftware/neat-ai";

import type { RandomNumberGenerator } from "@stsoftware/neat-ai";
```

```typescript
interface RandomNumberGenerator {
  random(): number; // [0, 1)
  randomInt(min: number, max: number): number; // [min, max] inclusive
  choice<T>(array: readonly T[]): T; // Random element from array
  readonly seeded: boolean; // true if deterministic
}
```

```typescript
const rng = createSeededRng(42);
setRandomNumberGenerator(rng);
// All subsequent random calls are reproducible

const options: NeatOptions = {
  seed: 42, // Internally creates a seeded RNG
};

setRandomNumberGenerator(createUnseededRng()); // Reset to non-deterministic
```

Seeded RNG uses the xoshiro256** algorithm internally.

---

## 🔗 Related topics

- [Evolution API](EVOLUTION.md) — `Creature.evolveDir()` consumes these options.
- [Costs and activations](COSTS_AND_ACTIVATIONS.md) — values referenced by
  `costName` and the activation menu.
- [Training](TRAINING.md) — backpropagation options interact with the training
  fields above.
- [Discovery](DISCOVERY.md) — discovery sub-config fields detailed.
- [Compute / multithreading](COMPUTE.md) — `threads`, WASM cache, and
  worker-related fields.
- [`CONFIGURATION_GUIDE.md`](../CONFIGURATION_GUIDE.md) — narrative
  configuration guide.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
