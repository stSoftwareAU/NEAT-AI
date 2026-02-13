# NEAT-AI API Reference

Comprehensive reference for the public API exported from `mod.ts`.

All imports use the single entry point:

```typescript
import { Costs, Creature, Mutation, Selection } from "@stsoftware/neat-ai";
```

---

## Table of Contents

1. [Core Classes](#1-core-classes)
2. [Configuration](#2-configuration)
3. [Activation Functions](#3-activation-functions)
4. [Cost Functions](#4-cost-functions)
5. [Training API (Backpropagation)](#5-training-api-backpropagation)
6. [Evolution API](#6-evolution-api)
7. [Discovery API](#7-discovery-api)
8. [Serialisation](#8-serialisation)
9. [Error Types](#9-error-types)
10. [Worker API](#10-worker-api)
11. [Intelligent Design](#11-intelligent-design)
12. [Plateau Detection](#12-plateau-detection)
13. [Logger](#13-logger)
14. [Random Number Generator](#14-random-number-generator)
15. [Utilities](#15-utilities)

---

## 1. Core Classes

### Creature

The central class representing a neural network (genome) in NEAT.

```typescript
import { Creature } from "@stsoftware/neat-ai";
```

#### Constructor

```typescript
new Creature(input: number, output: number, options?: {
  lazyInitialization?: boolean;
  semanticVersion?: string;
})
```

| Parameter                    | Type      | Description                           |
| ---------------------------- | --------- | ------------------------------------- |
| `input`                      | `number`  | Number of input neurons               |
| `output`                     | `number`  | Number of output neurons              |
| `options.lazyInitialization` | `boolean` | Skip default wiring (used internally) |
| `options.semanticVersion`    | `string`  | Version tag for the creature format   |

#### Properties

| Property          | Type                            | Description                                       |
| ----------------- | ------------------------------- | ------------------------------------------------- |
| `input`           | `number`                        | Number of input neurons                           |
| `output`          | `number`                        | Number of output neurons                          |
| `neurons`         | `Neuron[]`                      | All neurons in the network                        |
| `synapses`        | `Synapse[]`                     | All synapses (connections)                        |
| `score`           | `number \| undefined`           | Fitness score after evaluation                    |
| `uuid`            | `string \| undefined`           | Unique identifier                                 |
| `memetic`         | `MemeticInterface \| undefined` | Origin tracking metadata                          |
| `tags`            | `TagInterface[] \| undefined`   | User-defined metadata tags                        |
| `semanticVersion` | `string`                        | Creature format version                           |
| `forwardOnly`     | `boolean \| undefined`          | When `true`, no recurrent connections are allowed |

#### Key Methods

| Method             | Signature                                                                                   | Description                                                         |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `activate`         | `(input: Float32Array, feedbackLoop?: boolean): Float32Array`                               | Forward pass through the network using WASM. Returns output values. |
| `activateAndTrace` | `(input: Float32Array, feedbackLoop: boolean, sparseConfig: SparseConfig): Float32Array`    | Activation with tracing enabled for analysis.                       |
| `propagate`        | `(expected: Float32Array, config: BackPropagationConfig, sparseConfig: SparseConfig): void` | Backpropagation — propagates errors backwards through the network.  |
| `propagateUpdate`  | `(config: BackPropagationConfig, sparseConfig: SparseConfig): void`                         | Updates weights/biases based on propagated errors.                  |
| `record`           | `(expected: Float32Array): Map<string, DiscoverRecord>`                                     | Records expected outputs for discovery analysis.                    |
| `exportJSON`       | `(): CreatureExport`                                                                        | Serialises the creature to a JSON-compatible object.                |
| `traceJSON`        | `(): CreatureTrace`                                                                         | Exports with detailed trace information from last activation.       |
| `loadFrom`         | `(json: CreatureInternal \| CreatureExport, validate: boolean): void`                       | Loads creature structure from a JSON object.                        |
| `connect`          | `(from: number, to: number, weight: number, type?: SynapseType): Synapse`                   | Creates a synapse between two neurons.                              |
| `getSynapse`       | `(from: number, to: number): Synapse \| null`                                               | Gets the synapse between two neurons, or `null`.                    |
| `shallowClone`     | `(): Creature`                                                                              | Fast clone without JSON serialisation overhead.                     |
| `dispose`          | `(): void`                                                                                  | Releases all resources and memory.                                  |
| `clearCache`       | `(from?: number, to?: number): void`                                                        | Clears internal synapse connection caches.                          |

#### Static Methods

| Method     | Signature                                                                  | Description                                                                          |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `fromJSON` | `(json: CreatureInternal \| CreatureExport, validate?: boolean): Creature` | Creates a creature from a JSON object. Handles legacy format upgrades automatically. |

#### Example

```typescript
const creature = new Creature(2, 1);
const output = creature.activate(new Float32Array([0.5, 0.3]));
console.log(output); // Float32Array with 1 element

const json = creature.exportJSON();
const clone = Creature.fromJSON(json);
```

---

### CRISPR

Targeted genetic modifications inspired by CRISPR gene-editing technology.
Allows hand-crafted injection of neurons and synapses.

```typescript
import { CRISPR } from "@stsoftware/neat-ai";
import type { CrisprInterface } from "@stsoftware/neat-ai";
```

#### Constructor

```typescript
new CRISPR(creature: Creature)
```

#### Methods

| Method                 | Signature                                                                  | Description                                            |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `cleaveDNA`            | `(dna: CrisprInterface): Creature`                                         | Applies modifications and returns the edited creature. |
| `editAliases` (static) | `(dna: CrisprInterface, aliases: Record<string, string>): CrisprInterface` | Replaces neuron UUID aliases in DNA.                   |

#### CrisprInterface

```typescript
interface CrisprInterface {
  id: string; // Unique modification ID
  mode: "insert" | "append"; // insert: replace topology; append: add to existing
  neurons?: {
    uuid?: string;
    index?: number;
    type: "output" | "hidden";
    squash: string; // Activation function name
    bias: number;
  }[];
  synapses: {
    fromUUID?: string;
    toUUID?: string;
    weight: number;
    type?: "positive" | "negative" | "condition";
  }[];
}
```

---

## 2. Configuration

### NeatOptions

The primary configuration type for the NEAT algorithm. Passed to
`Creature.evolveDir()`.

```typescript
import type { NeatOptions, NeatOptionsInput } from "@stsoftware/neat-ai";
```

`NeatOptionsInput` is identical but accepts `string | number` for numeric fields
(useful for CLI argument parsing).

#### Core Fields

| Field            | Type                  | Default        | Description                              |
| ---------------- | --------------------- | -------------- | ---------------------------------------- |
| `costName`       | `CostName`            | `"MSE"`        | Cost function name                       |
| `populationSize` | `number`              | `50`           | Target population size                   |
| `iterations`     | `number`              | `1000`         | Maximum evolution generations            |
| `targetError`    | `number`              | `0.05`         | Stop when error falls below this         |
| `mutationRate`   | `number`              | `0.5`          | Probability of mutation (0–1)            |
| `mutationAmount` | `number`              | `1`            | Mutation magnitude scale                 |
| `elitism`        | `number`              | `0.2`          | Fraction of top performers to retain     |
| `selection`      | `SelectionInterface`  | `TOURNAMENT`   | Selection strategy                       |
| `mutation`       | `MutationInterface[]` | `Mutation.FFW` | Allowed mutation types                   |
| `threads`        | `number`              | `1`            | Worker threads for parallel evaluation   |
| `verbose`        | `boolean`             | `false`        | Enable debug logging                     |
| `log`            | `number`              | `100`          | Log status every N generations (0 = off) |

#### Training Fields

| Field                          | Type     | Default | Description                                |
| ------------------------------ | -------- | ------- | ------------------------------------------ |
| `trainPerGen`                  | `number` | `1`     | Backpropagation iterations per generation  |
| `trainingBatchSize`            | `number` | `32`    | Samples per training batch                 |
| `trainingSampleRate`           | `number` | `1.0`   | Fraction of data used per training pass    |
| `maximumBiasAdjustmentScale`   | `number` | `10`    | Max bias change per backpropagation step   |
| `maximumWeightAdjustmentScale` | `number` | `10`    | Max weight change per backpropagation step |
| `sparseRatio`                  | `number` | `0.2`   | Neuron selection ratio for sparse updates  |

#### Network Constraints

| Field                  | Type      | Default       | Description                           |
| ---------------------- | --------- | ------------- | ------------------------------------- |
| `feedbackLoop`         | `boolean` | `false`       | Enable recurrent connections          |
| `maxConns`             | `number`  | `Infinity`    | Maximum synapses allowed              |
| `maximumNumberOfNodes` | `number`  | `Infinity`    | Maximum hidden neurons allowed        |
| `costOfGrowth`         | `number`  | `0.000_000_1` | Complexity penalty per synapse/neuron |

#### Discovery Fields

| Field                             | Type     | Default | Description                                  |
| --------------------------------- | -------- | ------- | -------------------------------------------- |
| `discoverySampleRate`             | `number` | `0.2`   | Fraction of data for discovery (20%)         |
| `discoveryRecordTimeOutMinutes`   | `number` | `5`     | Minutes for discovery recording phase        |
| `discoveryAnalysisTimeoutMinutes` | `number` | `10`    | Minutes for discovery analysis               |
| `discoveryBatchSize`              | `number` | `256`   | Samples per discovery analysis batch         |
| `discoveryMaxNeurons`             | `number` | `6`     | Max neurons analysed per discovery iteration |

#### Evolution Fields

| Field                             | Type     | Default | Description                                    |
| --------------------------------- | -------- | ------- | ---------------------------------------------- |
| `timeoutMinutes`                  | `number` | `0`     | Evolution timeout (0 = unlimited)              |
| `focusRate`                       | `number` | `0`     | Attention weight for focus list observations   |
| `globalBreedingRate`              | `number` | `0.5`   | Cross-species vs within-species breeding ratio |
| `geneticCompatibilityThreshold`   | `number` | `1.3`   | Genetic distance threshold for speciation      |
| `creativeThinkingConnectionCount` | `number` | `1`     | New connections during creative thinking       |
| `dataSetPartitionBreak`           | `number` | `2000`  | Records per dataset file partition             |

#### Reproducibility Fields

| Field  | Type                    | Default     | Description                            |
| ------ | ----------------------- | ----------- | -------------------------------------- |
| `seed` | `number`                | `undefined` | PRNG seed for deterministic evolution  |
| `rng`  | `RandomNumberGenerator` | `undefined` | Custom RNG instance (overrides `seed`) |

#### Sub-Configuration Objects

These optional objects control advanced features. Each has a `Required*` type
used internally after defaults are applied.

##### `plateauDetection` — PlateauDetectionConfig

| Field                           | Type      | Default | Description                                       |
| ------------------------------- | --------- | ------- | ------------------------------------------------- |
| `enabled`                       | `boolean` | `false` | Enable plateau detection                          |
| `windowSize`                    | `number`  | `10`    | Generations in the improvement window             |
| `minImprovementRate`            | `number`  | `0.001` | Minimum improvement rate (0.1%)                   |
| `rapidImprovementRate`          | `number`  | `0.01`  | Threshold for "rapid" improvement (1%)            |
| `responseMutationMultiplier`    | `number`  | `2.0`   | Mutation rate multiplier on plateau               |
| `responseImprovementMultiplier` | `number`  | `0.8`   | Mutation rate multiplier during rapid improvement |

##### `stabilityAdaptation` — StabilityAdaptationConfig

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

##### `weightRegularisation` — WeightRegularisationConfig

| Field                | Type      | Default | Description                        |
| -------------------- | --------- | ------- | ---------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable weight regularisation       |
| `maxAbsoluteWeight`  | `number`  | `100`   | Maximum absolute weight value      |
| `maxWeightChange`    | `number`  | `10`    | Maximum weight change per mutation |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength         |
| `preferSmallChanges` | `boolean` | `true`  | Prefer small weight changes        |
| `smallChangeScale`   | `number`  | `0.5`   | Scale for small changes            |

##### `biasRegularisation` — BiasRegularisationConfig

| Field                | Type      | Default | Description                      |
| -------------------- | --------- | ------- | -------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable bias regularisation       |
| `maxAbsoluteBias`    | `number`  | `100`   | Maximum absolute bias value      |
| `maxBiasChange`      | `number`  | `10`    | Maximum bias change per mutation |
| `l2Strength`         | `number`  | `0.1`   | L2 regularisation strength       |
| `preferSmallChanges` | `boolean` | `true`  | Prefer small bias changes        |
| `smallChangeScale`   | `number`  | `0.5`   | Scale for small changes          |

##### `ensembleDiversity` — EnsembleDiversityConfig

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

##### `quantumStep` — QuantumStepConfig

| Field        | Type     | Default       | Description                   |
| ------------ | -------- | ------------- | ----------------------------- |
| `minStep`    | `number` | `0.000_000_1` | Minimum fine-tuning step size |
| `maxStep`    | `number` | `0.001`       | Maximum fine-tuning step size |
| `errorScale` | `number` | `10`          | Error scaling factor          |

##### `fineTunePopulation` — FineTunePopulationConfig

| Field                    | Type     | Default | Description                                 |
| ------------------------ | -------- | ------- | ------------------------------------------- |
| `minPopulationFraction`  | `number` | `0.1`   | Minimum population fraction for fine-tuning |
| `maxPopulationFraction`  | `number` | `0.5`   | Maximum population fraction for fine-tuning |
| `basePopulationFraction` | `number` | `0.3`   | Base population fraction                    |
| `successRateWindow`      | `number` | `10`    | Window for success rate tracking            |

##### `adaptiveMutationThresholds` — AdaptiveMutationThresholds

| Field                 | Type     | Default | Description                                            |
| --------------------- | -------- | ------- | ------------------------------------------------------ |
| `medium`              | `number` | `100`   | Synapse count threshold for "medium" creatures         |
| `large`               | `number` | `300`   | Synapse count threshold for "large" creatures          |
| `largeTopologyWeight` | `number` | `0.1`   | Topology mutation weight reduction for large creatures |

---

## 3. Activation Functions

NEAT-AI provides 37 activation functions (called "squash" functions). The
library uses WASM for all activation computation.

```typescript
// Activations are referenced by name in neuron definitions
// The library handles activation internally via WASM
```

### Summary Table

Priority controls how often an activation is chosen during random mutation.
Higher priority means more likely to be selected.

| Activation          | Priority | Range          | Best For                                  |
| ------------------- | :------: | -------------- | ----------------------------------------- |
| **LeakyReLU**       |    10    | (-Inf, +Inf)   | General purpose, default choice           |
| **GELU**            |    9     | ~(-0.17, +Inf) | Deep networks, transformer-style          |
| **Swish**           |    8     | ~(-0.28, +Inf) | Deep networks, smooth non-linearity       |
| **TANH**            |    8     | (-1, 1)        | Bounded output, recurrent networks        |
| **LOGISTIC**        |    7     | (0, 1)         | Binary classification, probability output |
| **Softplus**        |    7     | (0, +Inf)      | Smooth approximation to ReLU              |
| **Mish**            |    6     | ~(-0.31, +Inf) | Deep networks, stable gradients           |
| **ELU**             |    6     | (-1, +Inf)     | Regression, avoids dead neurons           |
| **SELU**            |    5     | ~(-1.76, +Inf) | Self-normalising networks                 |
| **HARD_TANH**       |    5     | [-1, 1]        | Fast bounded output                       |
| **ReLU**            |    5     | [0, +Inf)      | Simple, fast activation                   |
| **BENT_IDENTITY**   |    4     | (-Inf, +Inf)   | Always smooth, no dead zones              |
| **SOFTSIGN**        |    4     | (-1, 1)        | Soft alternative to TANH                  |
| **ArcTan**          |    4     | (-pi/2, pi/2)  | Smooth, always nonzero slope              |
| **ReLU6**           |    4     | [0, 6]         | Mobile/embedded applications              |
| **SINE**            |    3     | [-1, 1]        | Periodic patterns                         |
| **ABSOLUTE**        |    2     | [0, +Inf)      | Magnitude detection                       |
| **Cosine**          |    2     | [-1, 1]        | Periodic patterns                         |
| **Cube**            |    2     | (-Inf, +Inf)   | Non-linear, fast                          |
| **Exponential**     |    2     | (0, +Inf)      | Exponential growth patterns               |
| **GAUSSIAN**        |    2     | (0, 1]         | Radial basis patterns                     |
| **ISRU**            |    2     | (-1, 1)        | Smooth, fades in tails                    |
| **LogSigmoid**      |    2     | (-Inf, 0)      | Negative log-probability                  |
| **TAN**             |    2     | (-Inf, +Inf)   | Unbounded periodic                        |
| **BIPOLAR_SIGMOID** |    1     | (-1, 1)        | Symmetric sigmoid                         |
| **StdInverse**      |    1     | (-Inf, +Inf)   | Inverse function                          |
| **IDENTITY**        |    1     | (-Inf, +Inf)   | Pass-through (linear)                     |
| **COMPLEMENT**      |    0     | (-Inf, +Inf)   | Inversion (1 - x)                         |
| **STEP**            |    0     | {0, 1}         | Binary threshold                          |
| **IF**              |    0     | Conditional    | Multi-input conditional                   |
| **BIPOLAR**         |    0     | {-1, 1}        | Binary symmetric threshold                |
| **HYPOT**           |    0     | Special        | Euclidean distance                        |
| **HYPOTv2**         |    0     | Special        | Euclidean distance (variant)              |
| **MAXIMUM**         |    0     | Special        | Max of inputs                             |
| **MINIMUM**         |    0     | Special        | Min of inputs                             |

For detailed backpropagation strategy notes, see
[`src/methods/activations/README.md`](../src/methods/activations/README.md).

---

## 4. Cost Functions

Cost functions measure the error between predicted and expected outputs.

```typescript
import { Costs } from "@stsoftware/neat-ai";
import type { CostInterface } from "@stsoftware/neat-ai";
```

### Built-in Cost Functions

| Name              | Class                          | Best For                     | Formula                                 |
| ----------------- | ------------------------------ | ---------------------------- | --------------------------------------- |
| `"MSE"`           | Mean Squared Error             | General regression (default) | `(1/n) * Sum((y - y')^2)`               |
| `"MAE"`           | Mean Absolute Error            | Regression with outliers     | `(1/n) * Sum(\|y - y'\|)`               |
| `"MAPE"`          | Mean Absolute Percentage Error | Forecasting, relative error  | `(1/n) * Sum(\|(y' - y) / y\|)`         |
| `"MSLE"`          | Mean Squared Logarithmic Error | Wide value ranges            | `(1/n) * Sum((log(y) - log(y'))^2)`     |
| `"CROSS_ENTROPY"` | Cross Entropy                  | Classification               | `-Sum(y * log(y') + (1-y) * log(1-y'))` |
| `"HINGE"`         | Hinge Loss                     | SVM / binary classification  | `max(0, 1 - y * y')`                    |

### CostInterface

Custom cost functions implement this interface:

```typescript
interface CostInterface {
  getName(): string;
  calculate(target: Float32Array, output: Float32Array): number;
}
```

### Costs Registry

```typescript
// Find a cost function by name
const mse = Costs.find("MSE");
const error = mse.calculate(target, output);

// List all available costs
const names: string[] = Costs.getAvailableCosts();

// Register a custom cost function
Costs.registerCustomCost(myCustomCost);

// Register a factory (creates new instances on demand)
Costs.registerCostFactory("MY_COST", () => new MyCost());
```

---

## 5. Training API (Backpropagation)

NEAT-AI uses elastic backpropagation to train creatures within each generation.
Training is typically invoked internally by `evolveDir()`, but can be called
directly for fine-grained control.

### BackPropagationOptions

```typescript
interface BackPropagationOptions {
  generations?: number; // Training iterations (default: random 1–100)
  learningRate?: number; // 0–1 (default: random low value)
  batchSize?: number; // Samples per batch (default: 64)
  sparseRatio?: number; // Neuron selection ratio (default: 1.0)
  trainingMutationRate?: number; // Gene change probability (default: random)
  plankConstant?: number; // Minimum unit of change (default: 0.000_000_1)
  maximumBiasAdjustmentScale?: number; // Max bias delta (default: 1)
  maximumWeightAdjustmentScale?: number; // Max weight delta (default: 1)
  limitBiasScale?: number; // Absolute bias cap (default: 10_000)
  limitWeightScale?: number; // Absolute weight cap (default: 100_000)
  disableBiasAdjustment?: boolean; // Skip bias updates (default: false)
  disableWeightAdjustment?: boolean; // Skip weight updates (default: false)
  disableRandomSamples?: boolean; // Use sequential sampling (default: false)
  learningRateStrategy?: "fixed" | "decay" | "adaptive"; // Default: random
  initialLearningRate?: number; // For decay/adaptive (default: 0.01)
  learningRateDecay?: number; // Decay factor (default: 0.95)
}
```

### Direct Training Example

```typescript
import { Creature } from "@stsoftware/neat-ai";

const creature = new Creature(2, 1);

// Activate, then propagate errors
const input = new Float32Array([1.0, 0.0]);
const expected = new Float32Array([1.0]);

creature.activate(input);
// Propagation is handled internally by evolveDir() during evolution
```

---

## 6. Evolution API

The main entry point for NEAT evolution.

### Creature.evolveDir()

```typescript
async evolveDir(
  dataSetDir: string,
  options: NeatOptions,
): Promise<{
  error: number;
  score: number;
  time: number;
  generation: number;
}>
```

| Parameter    | Type          | Description                                           |
| ------------ | ------------- | ----------------------------------------------------- |
| `dataSetDir` | `string`      | Path to directory containing training data JSON files |
| `options`    | `NeatOptions` | Evolution configuration                               |

**Returns** an object with:

- `error` — Final best error
- `score` — Final best score (negative error minus complexity penalty)
- `time` — Elapsed milliseconds
- `generation` — Number of generations completed

### Dataset Format

Training data is stored as JSON files in `dataSetDir`, each containing an array
of samples:

```json
[
  { "input": [0, 0], "output": [0] },
  { "input": [0, 1], "output": [1] },
  { "input": [1, 0], "output": [1] },
  { "input": [1, 1], "output": [0] }
]
```

### Evolution Example

```typescript
import { Creature } from "@stsoftware/neat-ai";
import type { NeatOptions } from "@stsoftware/neat-ai";

const creature = new Creature(2, 1);

const options: NeatOptions = {
  costName: "MSE",
  populationSize: 100,
  iterations: 500,
  targetError: 0.01,
  mutationRate: 0.3,
  elitism: 0.2,
  threads: 4,
  seed: 42, // Reproducible evolution
};

const result = await creature.evolveDir("./training-data", options);
console.log(`Error: ${result.error}, Generations: ${result.generation}`);
```

### Selection Strategies

```typescript
import { Selection } from "@stsoftware/neat-ai";
```

| Strategy                          | Description                                          | Parameters                    |
| --------------------------------- | ---------------------------------------------------- | ----------------------------- |
| `Selection.FITNESS_PROPORTIONATE` | Roulette wheel selection based on fitness proportion | —                             |
| `Selection.POWER`                 | Fitness raised to a power before selection           | `power: 4`                    |
| `Selection.TOURNAMENT`            | Best of random subset is selected                    | `size: 5`, `probability: 0.5` |

### Mutation Types

```typescript
import { Mutation } from "@stsoftware/neat-ai";
```

| Mutation        | Description                                   |
| --------------- | --------------------------------------------- |
| `ADD_NODE`      | Add a new hidden neuron                       |
| `SUB_NODE`      | Remove a hidden neuron                        |
| `ADD_CONN`      | Add a new forward connection                  |
| `SUB_CONN`      | Remove a connection                           |
| `MOD_WEIGHT`    | Modify a synapse weight                       |
| `MOD_BIAS`      | Modify a neuron bias                          |
| `MOD_SQUASH`    | Change a neuron's activation function         |
| `SWAP_NODES`    | Swap two neurons                              |
| `ADD_SELF_CONN` | Add a self-loop (recurrent only)              |
| `SUB_SELF_CONN` | Remove a self-loop (recurrent only)           |
| `ADD_BACK_CONN` | Add a backward connection (recurrent only)    |
| `SUB_BACK_CONN` | Remove a backward connection (recurrent only) |

**Preset groups:**

- `Mutation.FFW` — Forward-feed mutations only (default): `ADD_NODE`,
  `SUB_NODE`, `ADD_CONN`, `SUB_CONN`, `MOD_WEIGHT`, `MOD_BIAS`, `MOD_SQUASH`,
  `SWAP_NODES`
- `Mutation.ALL` — All mutations including recurrent connections

---

## 7. Discovery API

Discovery uses the Rust FFI extension
([NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)) for
GPU-accelerated structural analysis. It analyses error patterns and suggests
neurons/synapses to add.

```typescript
import {
  formatErrorDelta,
  formatPercentWithSignificantDigits,
} from "@stsoftware/neat-ai";
import type { DiscoveryEvaluationSummary } from "@stsoftware/neat-ai";
```

### How Discovery Works

1. The creature records expected vs actual outputs during evaluation
2. Error data is streamed to the Rust discovery library via FFI
3. The Rust module (using GPU compute shaders via Metal/wgpu) analyses error
   patterns and proposes structural changes
4. Proposed candidates are evaluated and the best improvement is kept

### Configuration

Discovery is configured via `NeatOptions` fields:

- `discoverySampleRate` (default `0.2`): Fraction of training data used
- `discoveryRecordTimeOutMinutes` (default `5`): Recording phase timeout
- `discoveryAnalysisTimeoutMinutes` (default `10`): Analysis phase timeout
- `discoveryBatchSize` (default `256`): Samples per batch
- `discoveryMaxNeurons` (default `6`): Max neurons per iteration

### DiscoveryEvaluationSummary

```typescript
interface DiscoveryEvaluationSummary {
  kind: "original" | "candidate";
  changeType?: string;
  description?: string;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
  archivePath?: string;
  errorDelta?: number;
  errorDeltaPct?: number;
}
```

### Formatting Utilities

```typescript
// Format an error delta for display
const text = formatErrorDelta(0.0523);

// Format a percentage with significant digits
const pct = formatPercentWithSignificantDigits(0.0523);
```

For a complete guide, see [`docs/DISCOVERY_GUIDE.md`](DISCOVERY_GUIDE.md) and
[`docs/GPU_ACCELERATION.md`](GPU_ACCELERATION.md).

---

## 8. Serialisation

### CreatureExport

The JSON format for serialising and deserialising creatures.

```typescript
import type {
  CreatureExport,
  CreatureTrace,
  NeuronExport,
  SynapseExport,
} from "@stsoftware/neat-ai";
```

#### CreatureExport Structure

```typescript
interface CreatureExport {
  input: number; // Number of input neurons
  output: number; // Number of output neurons
  neurons: NeuronExport[]; // Hidden and output neurons
  synapses: SynapseExport[]; // All connections
  forwardOnly?: boolean; // No recurrent connections
  memetic?: MemeticInterface; // Origin tracking
  semanticVersion?: string; // Format version
  tags?: TagInterface[]; // User-defined metadata
}
```

#### NeuronExport Structure

```typescript
interface NeuronExport {
  uuid: string; // Unique neuron identifier
  type: "hidden" | "output" | "constant";
  bias: number; // Neuron bias value
  squash?: string; // Activation function name
  tags?: TagInterface[]; // User-defined metadata
}
```

Input neurons are implicit (defined by `input` count) and not included in the
`neurons` array.

#### SynapseExport Structure

```typescript
interface SynapseExport {
  fromUUID: string; // Source neuron UUID
  toUUID: string; // Target neuron UUID
  weight: number; // Connection weight
  type?: "positive" | "negative" | "condition";
  tags?: TagInterface[]; // User-defined metadata
}
```

#### CreatureTrace

Extends `CreatureExport` with per-neuron and per-synapse trace information from
the last activation, useful for debugging and analysis.

```typescript
interface CreatureTrace extends CreatureExport {
  neurons: NeuronTrace[]; // Neurons with activation trace
  synapses: SynapseTrace[]; // Synapses with trace
}
```

### Import/Export Example

```typescript
import { Creature } from "@stsoftware/neat-ai";

// Export
const creature = new Creature(2, 1);
const json = creature.exportJSON();
const jsonString = JSON.stringify(json, null, 2);

// Import
const restored = Creature.fromJSON(JSON.parse(jsonString));

// Trace (includes activation state)
creature.activate(new Float32Array([0.5, 0.5]));
const trace = creature.traceJSON();
```

### Version Upgrades

Legacy creature formats (v0.x, v1.x) are automatically upgraded when loaded via
`Creature.fromJSON()`. Use `upgradeTwo()` for explicit v2.0.0 migration.

```typescript
import { Upgrade, upgradeTwo } from "@stsoftware/neat-ai";
```

---

## 9. Error Types

### ValidationError

Typed error for structural validation failures.

```typescript
// ValidationError is not directly exported from mod.ts but is thrown by
// creature validation. Import from source if needed:
// import { ValidationError } from "./src/errors/ValidationError.ts";
```

```typescript
type ValidationErrorName =
  | "OTHER"
  | "NO_OUTWARD_CONNECTIONS" // Neuron has no outgoing synapses
  | "NO_INWARD_CONNECTIONS" // Neuron has no incoming synapses
  | "IF_CONDITIONS" // IF neuron validation failed
  | "RECURSIVE_SYNAPSE" // Backward connection in forward-only mode
  | "SELF_CONNECTION" // Self-loop in forward-only mode
  | "MEMETIC"; // Memetic (origin) tracking error

class ValidationError extends Error {
  name: ValidationErrorName;
  constructor(message: string, name: ValidationErrorName);
}
```

### Error Handling Patterns

```typescript
import { Creature } from "@stsoftware/neat-ai";

try {
  const creature = Creature.fromJSON(jsonData, true); // validate = true
} catch (error) {
  if (error instanceof Error && error.name === "RECURSIVE_SYNAPSE") {
    console.error("Network has backward connections in forward-only mode");
  }
}
```

---

## 10. Worker API

Multi-threaded evaluation using Deno workers.

```typescript
import { fetchWasmForWorkers } from "@stsoftware/neat-ai";
```

### WASM Preloading

Call `fetchWasmForWorkers()` in the main thread before spawning workers so WASM
is fetched once and cached. Workers then receive the cached payload instead of
each fetching separately.

```typescript
// Main thread — call once before evolveDir() with threads > 1
await fetchWasmForWorkers();
```

### Using Multiple Threads

Workers are managed automatically by `Creature.evolveDir()` when `threads > 1`:

```typescript
const result = await creature.evolveDir("./data", {
  threads: 4, // Use 4 worker threads
  costName: "MSE",
  iterations: 100,
});
```

Workers handle evaluation, training, discovery, and breeding in parallel. If a
worker fails to initialise (e.g. in restricted environments), it falls back to
direct (in-process) execution automatically.

---

## 11. Intelligent Design

Systematic optimisation of activation functions per neuron via brute-force
search. Tests alternative squash functions and applies the best combination.

```typescript
import {
  alternativeSquashes,
  combineImprovements,
  getNeuronsToTest,
  getValidNeuronSquashes,
  // Worker support
  IntelligentDesignWorkerHandler,
  IntelligentDesignWorkerProcessor,
  makeModifiedCreature,
  // File utilities
  safeWriteJson,
  safeWriteText,
  scanForSquashImprovements,
  shuffle,
} from "@stsoftware/neat-ai";

import type {
  BestNeuronSquash,
  ImproveSquashOptions,
  ImproveSquashResult,
  TacitKnowledgeMap,
  TacitKnowledgeResult,
} from "@stsoftware/neat-ai";
```

For a complete guide, see [`docs/INTELLIGENT_DESIGN.md`](INTELLIGENT_DESIGN.md).

---

## 12. Plateau Detection

Detects when evolution stagnates and adjusts mutation rates to help escape local
optima.

```typescript
import {
  DEFAULT_PLATEAU_DETECTION,
  detectPlateau,
  PlateauDetector,
} from "@stsoftware/neat-ai";

import type {
  PlateauDetectionConfig,
  RequiredPlateauDetectionConfig,
} from "@stsoftware/neat-ai";
```

### PlateauDetector

```typescript
class PlateauDetector {
  constructor(config: RequiredPlateauDetectionConfig);

  recordFitness(fitness: number): void;
  isOnPlateau(): boolean;
  isRapidlyImproving(): boolean;
  getMutationMultiplier(): number;
  getGenerationsOnPlateau(): number;
}
```

### Example

```typescript
const detector = new PlateauDetector({
  ...DEFAULT_PLATEAU_DETECTION,
  enabled: true,
});

// Each generation, record the best fitness
detector.recordFitness(-0.5);
detector.recordFitness(-0.49);

if (detector.isOnPlateau()) {
  const multiplier = detector.getMutationMultiplier();
  // multiplier > 1.0 when on plateau (increase mutations)
}
```

Plateau detection is also available as a NeatOptions sub-config and applied
automatically during evolution.

---

## 13. Logger

Structured logging abstraction. Consumers can inject a custom logger via
NeatOptions or call `setLogger()` globally.

```typescript
import {
  createConsoleLogger,
  getLogger,
  setLogger,
  SILENT_LOGGER,
} from "@stsoftware/neat-ai";

import type { Logger, LogLevel } from "@stsoftware/neat-ai";
```

### Logger Interface

```typescript
interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

type LogLevel = "debug" | "info" | "warn" | "error" | "none";
```

### Usage

```typescript
// Get the global logger
const logger = getLogger();
logger.info("Training started");

// Set a custom logger
setLogger(createConsoleLogger("warn")); // Only warn and error

// Silence all logging
setLogger(SILENT_LOGGER);

// Via NeatOptions
const options: NeatOptions = {
  logger: createConsoleLogger("debug"),
  // or just set the level:
  logLevel: "warn",
};
```

---

## 14. Random Number Generator

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

### RandomNumberGenerator Interface

```typescript
interface RandomNumberGenerator {
  random(): number; // [0, 1)
  randomInt(min: number, max: number): number; // [min, max] inclusive
  choice<T>(array: readonly T[]): T; // Random element from array
  readonly seeded: boolean; // true if deterministic
}
```

### Usage

```typescript
// Deterministic evolution with a seed
const rng = createSeededRng(42);
setRandomNumberGenerator(rng);
// All subsequent random calls are reproducible

// Or via NeatOptions
const options: NeatOptions = {
  seed: 42, // Internally creates a seeded RNG
};

// Reset to non-deterministic
setRandomNumberGenerator(createUnseededRng());
```

Seeded RNG uses the xoshiro256** algorithm internally.

---

## 15. Utilities

### CreatureUtil

Utility class for working with creatures.

```typescript
import { CreatureUtil } from "@stsoftware/neat-ai";
```

### Upgrade

Handles version migration of creature formats.

```typescript
import { Upgrade, upgradeTwo } from "@stsoftware/neat-ai";

// Correct a creature export (fixes missing/incorrect data)
const corrected = Upgrade.correct(creatureJson, inputCount);

// Upgrade legacy CRISPR format
const upgradedDna = Upgrade.CRISPR(legacyDna);
```

### randomConnectMissing

Connects neurons that lack required connections.

```typescript
import { randomConnectMissing } from "@stsoftware/neat-ai";
```

---

## Further Reading

- [README.md](../README.md) — Project overview and quick start
- [AGENTS.md](../AGENTS.md) — Development guidelines and conventions
- [COMPARISON.md](../COMPARISON.md) — Comparison with other AI approaches
- [Discovery Guide](DISCOVERY_GUIDE.md) — Complete discovery workflow
- [GPU Acceleration](GPU_ACCELERATION.md) — GPU compute details
- [Backprop Elasticity](BACKPROP_ELASTICITY.md) — Elastic backpropagation
- [Intelligent Design](INTELLIGENT_DESIGN.md) — Squash optimisation guide
- [Activation Functions](../src/methods/activations/README.md) — Detailed
  activation function reference
