# ⚙️ Configuration Guide

This guide documents all NEAT-AI configuration options, their default values,
and when to adjust them. Configuration is passed via `NeatOptionsInput` to
`createNeatConfig()`, which validates, parses, and freezes the result into a
read-only `NeatConfig`.

Numeric options accept `number | string` so values can be passed directly from
CLI arguments or environment variables without pre-parsing.

> [!TIP]
> If you are new to NEAT-AI, start with the
> [Configuration Presets](#configuration-presets) section. The built-in presets
> cover the most common scenarios and are a faster path to a working
> configuration than assembling options from scratch.

## 📋 Table of Contents

- [Configuration Presets](#configuration-presets)
- [Quick Reference](#quick-reference)
- [Core Evolution Parameters](#core-evolution-parameters)
- [Training Parameters](#training-parameters)
- [Discovery Parameters](#discovery-parameters)
- [Discovery Replay Parameters](#discovery-replay-parameters)
- [Discovery Caching Parameters](#discovery-caching-parameters)
- [Discovery Debug Options](#discovery-debug-options)
- [Adaptive Mutation Thresholds](#adaptive-mutation-thresholds)
- [Plateau Detection](#plateau-detection)
- [Stability Adaptation](#stability-adaptation)
- [Weight Regularisation](#weight-regularisation)
- [Bias Regularisation](#bias-regularisation)
- [Ensemble Diversity](#ensemble-diversity)
- [Quantum Step](#quantum-step)
- [Fine-Tune Population](#fine-tune-population)
- [Worker Thread Cap](#worker-thread-cap)
- [Worker Pool Partitioning](#worker-pool-partitioning)
- [Output Range Constraints](#output-range-constraints)
- [Data Fuzzing](#data-fuzzing)
- [Cross-Validation](#cross-validation)
- [Hyperparameter Evolution](#hyperparameter-evolution)
- [MCMC Acceptance Criterion](#mcmc-acceptance-criterion)
- [Adaptive Population Sizing](#adaptive-population-sizing)
- [Parallel Evaluation](#parallel-evaluation)
- [Logging and Reproducibility](#logging-and-reproducibility)
- [Validation Rules](#validation-rules)
- [Recipes](#recipes)

---

## 🚀 Configuration Presets

Issue #1619: NEAT-AI ships pre-built configuration presets for common training
scenarios. Each preset is a `NeatOptions` object that can be spread into your
configuration — user overrides take precedence when spread after the preset.

```ts
import { createNeatConfig, QUICK_START_PRESET } from "@anthropic/neat-ai";

const config = createNeatConfig({
  ...QUICK_START_PRESET,
  populationSize: 25, // override the preset value
});
```

### 📊 Available Presets

| Preset                      | Population | Discovery | Timeout | Use Case                                   |
| --------------------------- | ---------- | --------- | ------- | ------------------------------------------ |
| `QUICK_START_PRESET`        | 10         | Disabled  | 5 min   | Learning, prototyping, quick experiments   |
| `LARGE_NETWORK_PRESET`      | 200        | 30%       | 2 hrs   | Complex problems with many inputs/outputs  |
| `MEMORY_CONSTRAINED_PRESET` | 20         | Disabled  | 30 min  | Limited-memory environments, CI/CD runners |
| `DISCOVERY_FOCUSED_PRESET`  | 100        | 50%       | 3 hrs   | Finding novel architectures, research      |

### ⚡ Quick Start

Small population, fast iterations, good for learning and prototyping. Discovery
is disabled for speed.

```ts
import { createNeatConfig, QUICK_START_PRESET } from "@anthropic/neat-ai";

const config = createNeatConfig({
  ...QUICK_START_PRESET,
  // Add your data directory and any overrides:
  targetError: 0.05,
});
```

**Settings:** `populationSize: 10`, `iterations: 100`, `targetError: 0.1`,
`discoverySampleRate: -1`, `timeoutMinutes: 5`

### 🔬 Large Network

Higher population with discovery, plateau detection, stability adaptation, and
ensemble diversity enabled. Suitable for complex problems requiring larger
architectures.

```ts
import { createNeatConfig, LARGE_NETWORK_PRESET } from "@anthropic/neat-ai";

const config = createNeatConfig({
  ...LARGE_NETWORK_PRESET,
  discoveryCacheDir: "./discovery-cache",
});
```

**Settings:** `populationSize: 200`, `iterations: 10_000`, `targetError: 0.01`,
`discoverySampleRate: 0.3`, `timeoutMinutes: 120`, plateau detection enabled,
stability adaptation enabled, ensemble diversity enabled

### 💾 Memory Constrained

Conservative resource usage for limited-memory environments. Uses fewer threads,
smaller populations, and disables discovery.

```ts
import {
  createNeatConfig,
  MEMORY_CONSTRAINED_PRESET,
} from "@anthropic/neat-ai";

const config = createNeatConfig({
  ...MEMORY_CONSTRAINED_PRESET,
});
```

**Settings:** `populationSize: 20`, `threads: 2`, `trainingBatchSize: 50`,
`discoverySampleRate: -1`, `timeoutMinutes: 30`

### 🔭 Discovery Focused

Aggressive structural evolution with higher sample rates, more neurons analysed
per iteration, and longer timeouts. Suitable for finding novel architectures.

```ts
import { createNeatConfig, DISCOVERY_FOCUSED_PRESET } from "@anthropic/neat-ai";

const config = createNeatConfig({
  ...DISCOVERY_FOCUSED_PRESET,
  discoveryCacheDir: "./discovery-cache",
});
```

**Settings:** `populationSize: 100`, `discoverySampleRate: 0.5`,
`discoveryMaxNeurons: 12`, `costOfGrowth: 0.00000001`, `timeoutMinutes: 180`,
plateau detection enabled

### 🔀 Composing Presets

Presets can be composed by spreading multiple presets or mixing with custom
overrides. Later values take precedence:

```ts
import {
  createNeatConfig,
  DISCOVERY_FOCUSED_PRESET,
  MEMORY_CONSTRAINED_PRESET,
} from "@anthropic/neat-ai";

// Start with memory constraints, then override with discovery settings
// but keep limited threads
const config = createNeatConfig({
  ...MEMORY_CONSTRAINED_PRESET,
  ...DISCOVERY_FOCUSED_PRESET,
  threads: 2, // keep limited threads
});
```

---

## 📊 Quick Reference

### 🧬 Core Evolution

| Option                            | Type       | Default                                                          | Description                                                                                                                       |
| --------------------------------- | ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `costName`                        | `CostName` | `"MSE"`                                                          | Cost/fitness function name                                                                                                        |
| `populationSize`                  | `integer`  | `50`                                                             | Target population size (min: 2)                                                                                                   |
| `iterations`                      | `integer`  | `MAX_SAFE_INTEGER`                                               | Maximum generations to evolve                                                                                                     |
| `targetError`                     | `number`   | `0.05`                                                           | Stop when error falls below this (0–1)                                                                                            |
| `mutationRate`                    | `number`   | `0.3`                                                            | Probability of mutating a gene (>0.001)                                                                                           |
| `mutationAmount`                  | `integer`  | `1`                                                              | Number of changes per gene during mutation (min: 1)                                                                               |
| `elitism`                         | `integer`  | `1`                                                              | Top-performing individuals retained each generation (min: 1)                                                                      |
| `costOfGrowth`                    | `number`   | `0.0000001`                                                      | Penalty per structural addition (min: 0)                                                                                          |
| `trainingSampleRate`              | `number`   | `1`                                                              | Fraction of data used for training (0.0001–1)                                                                                     |
| `trainPerGen`                     | `integer`  | `1`                                                              | Training sessions per generation (min: 0)                                                                                         |
| `trainingBatchSize`               | `integer`  | `100`                                                            | Observations per training batch (min: 1)                                                                                          |
| `dataSetPartitionBreak`           | `integer`  | `2000`                                                           | Records per dataset file (min: 1)                                                                                                 |
| `maxConns`                        | `integer`  | `MAX_SAFE_INTEGER`                                               | Maximum connections (min: 1)                                                                                                      |
| `maximumNumberOfNodes`            | `integer`  | `MAX_SAFE_INTEGER`                                               | Maximum neurons (min: 1)                                                                                                          |
| `timeoutMinutes`                  | `integer`  | `0`                                                              | Maximum training time in minutes (0 = unlimited)                                                                                  |
| `threads`                         | `integer`  | `navigator.hardwareConcurrency + heavyTaskWorkerCount` (default) | Worker threads (min: 1); default keeps fast pool ≥ one thread per logical CPU                                                     |
| `heavyTaskWorkerCount`            | `integer`  | `2`                                                              | Workers for heavy tasks (discovery/training); must be >= 1 and < threads when threads > 2. Partitioning disabled when threads ≤ 2 |
| `feedbackLoop`                    | `boolean`  | `false`                                                          | Enable recurrent connections                                                                                                      |
| `debug`                           | `boolean`  | `false`                                                          | Enable debug mode (slower)                                                                                                        |
| `verbose`                         | `boolean`  | `false`                                                          | Enable verbose logging                                                                                                            |
| `creativeThinkingConnectionCount` | `integer`  | `1`                                                              | New links during creative thinking phase                                                                                          |
| `geneticCompatibilityThreshold`   | `number`   | `0.3`                                                            | Speciation distance threshold (0–1)                                                                                               |
| `sparseRatio`                     | `number`   | `random * random`                                                | Fraction of neurons selected for sparse activation (0–1)                                                                          |
| `globalBreedingRate`              | `number`   | `random`                                                         | Ratio of cross-species vs within-species breeding (0–1)                                                                           |
| `maxCRISPRsPerGeneration`         | `integer`  | `1`                                                              | Maximum CRISPRs applied per generation (min: 1)                                                                                   |

### 🎲 Data Fuzzing & Training Robustness

| Option                                    | Type                      | Default      | Description                            |
| ----------------------------------------- | ------------------------- | ------------ | -------------------------------------- |
| `dataFuzzing.enabled`                     | `boolean`                 | `false`      | Enable training data noise injection   |
| `dataFuzzing.inputNoiseScale`             | `number`                  | `0.01`       | Input noise magnitude (0–1)            |
| `dataFuzzing.outputNoiseScale`            | `number`                  | `0`          | Output noise for label smoothing (0–1) |
| `dataFuzzing.noiseType`                   | `"gaussian" \| "uniform"` | `"gaussian"` | Noise distribution type                |
| `crossValidation.enabled`                 | `boolean`                 | `false`      | Enable k-fold cross-validation         |
| `crossValidation.folds`                   | `integer`                 | `5`          | Number of folds (1–20)                 |
| `crossValidation.validationEarlyStopping` | `boolean`                 | `true`       | Use validation fold for early stopping |

### 🧬 Hyperparameter Evolution & Adaptive Population

| Option                                      | Type      | Default  | Description                                        |
| ------------------------------------------- | --------- | -------- | -------------------------------------------------- |
| `hyperparameterEvolution.enabled`           | `boolean` | `false`  | Enable per-creature hyperparameter self-adaptation |
| `hyperparameterEvolution.minLearningRate`   | `number`  | `0.0001` | Lower bound for evolved learning rate              |
| `hyperparameterEvolution.maxLearningRate`   | `number`  | `0.1`    | Upper bound for evolved learning rate              |
| `hyperparameterEvolution.mutationStdDev`    | `number`  | `0.1`    | Gaussian std dev for hyperparameter mutation       |
| `adaptivePopulation.enabled`                | `boolean` | `false`  | Enable diversity-based population sizing           |
| `adaptivePopulation.lowDiversityThreshold`  | `number`  | `0.3`    | Diversity below this grows population              |
| `adaptivePopulation.highDiversityThreshold` | `number`  | `0.8`    | Diversity above this may shrink population         |
| `adaptivePopulation.minCreaturesPerWorker`  | `number`  | `3`      | Worker-aware floor: min creatures per worker       |

### 🧪 Synthetic Synapses

| Option              | Type      | Default | Description                                                |
| ------------------- | --------- | ------- | ---------------------------------------------------------- |
| `syntheticSynapses` | `boolean` | `false` | Generate dense inter-layer synapses before backpropagation |

### ⚡ Parallel Evaluation

| Option                                        | Type      | Default | Description                                       |
| --------------------------------------------- | --------- | ------- | ------------------------------------------------- |
| `parallelEvaluation.topologyGrouping`         | `boolean` | `true`  | Group same-topology creatures for WASM cache hits |
| `parallelEvaluation.maxConcurrentEvaluations` | `integer` | `0`     | Max workers for evaluation (0 = all)              |

### 🔧 Adjustment Scales

| Option                         | Type     | Default | Description                                               |
| ------------------------------ | -------- | ------- | --------------------------------------------------------- |
| `maximumBiasAdjustmentScale`   | `number` | `1`     | Maximum bias adjustment per training iteration (min: 0)   |
| `maximumWeightAdjustmentScale` | `number` | `1`     | Maximum weight adjustment per training iteration (min: 0) |

### 🔍 Discovery

| Option                              | Type      | Default   | Description                                                         |
| ----------------------------------- | --------- | --------- | ------------------------------------------------------------------- |
| `discoverySampleRate`               | `number`  | `0.2`     | Fraction of records sampled for structural analysis (-1 to disable) |
| `discoveryRecordTimeOutMinutes`     | `number`  | `5`       | Maximum minutes for the recording phase                             |
| `discoveryAnalysisTimeoutMinutes`   | `number`  | `10`      | Maximum minutes for the analysis phase (0.05–60)                    |
| `discoveryBatchSize`                | `integer` | `128`     | Observations per discovery promise                                  |
| `discoveryBufferSize`               | `number`  | `0`       | Read buffer size in bytes (0 = default)                             |
| `discoveryRustFlushRecords`         | `integer` | `4096`    | Records accumulated before flushing to Rust                         |
| `discoveryRustFlushBytes`           | `number`  | `~50 MiB` | Payload size threshold before flushing                              |
| `discoveryMaxNeurons`               | `integer` | `6`       | Maximum neurons analysed per discovery iteration                    |
| `discoveryDrainEveryNBatches`       | `integer` | `10`      | Drain promise chains every N batches                                |
| `maxConcurrentDiscoveries`          | `integer` | `1`       | Maximum concurrent discovery operations (pipelined scheduling)      |
| `discoveryMinCandidatesPerCategory` | `object`  | see below | Minimum candidates to evaluate per discovery category               |

### 🐛 Discovery Debug Options

| Option                                     | Type      | Default     | Description                                                               |
| ------------------------------------------ | --------- | ----------- | ------------------------------------------------------------------------- |
| `discoveryBaseDirectory`                   | `string`  | `undefined` | Custom base directory for discovery temporary files                       |
| `discoverySkipRecordPhase`                 | `boolean` | `false`     | Skip recording if parquet files already exist (debug/replay optimisation) |
| `discoveryDisableCleanup`                  | `boolean` | `false`     | Preserve parquet files after discovery for debugging                      |
| `discoveryDisableEvaluationSummaryLogging` | `boolean` | `false`     | Disable internal evaluation summary logging                               |

### 🔄 Discovery Replay

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

### 📂 Discovery Min Candidates Per Category

| Option            | Type      | Default | Description                                       |
| ----------------- | --------- | ------- | ------------------------------------------------- |
| `addNeurons`      | `integer` | `1`     | Minimum candidates for add-neurons category       |
| `addSynapses`     | `integer` | `1`     | Minimum candidates for add-synapses category      |
| `changeSquash`    | `integer` | `1`     | Minimum candidates for change-squash category     |
| `removeLowImpact` | `integer` | `3`     | Minimum candidates for remove-low-impact category |

---

## 🧬 Core Evolution Parameters

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

> [!WARNING]
> When `feedbackLoop` is `true`, `disableRandomSamples` must also be `true`.
> This constraint is enforced by validation and `createNeatConfig()` will throw
> if violated. See [Validation Rules](#validation-rules) for the full list of
> enforced constraints.

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

### `maxCRISPRsPerGeneration`

**Default: 1** | Type: integer | Min: 1

Maximum number of CRISPRs applied per generation. CRISPRs cycle across
generations instead of being permanently consumed. Increase this value to apply
multiple CRISPR injections per generation for faster structural convergence.

---

## 🏋️ Training Parameters

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

### `syntheticSynapses`

**Default: false** | Type: boolean

When enabled, dense zero-weight synapses are generated between adjacent
topological layers before backpropagation begins. After training, synthetic
synapses whose weights remain near zero are pruned, and any that have been
trained to meaningful weights are retained as permanent connections. This allows
backpropagation to discover useful connections that NEAT's evolutionary process
may not have found.

A per-target cap of 50 connections per target neuron per layer pair prevents
combinatorial explosion on wide networks. Orphaned neurons are cleaned up
automatically after pruning.

> [!TIP]
> Synthetic synapses are most beneficial for networks with sparse inter-layer
> connectivity — typically early in evolution when NEAT has not yet built dense
> connections between layers. For already-dense networks, the overhead may
> outweigh the benefit.

---

## 🔍 Discovery Parameters

Discovery uses the Rust FFI extension for GPU-accelerated structural analysis.
It proposes structural improvements (add neurons, add synapses, change
activation functions, remove low-impact elements) based on error patterns.

Set `discoverySampleRate` to `-1` to disable discovery entirely.

> [!NOTE]
> Discovery requires a Rust FFI extension and will only activate when
> `discoverySampleRate` is greater than `0`. When running in environments
> without the native extension (e.g., some CI runners), set
> `discoverySampleRate: -1` to avoid runtime errors.

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

### `maxConcurrentDiscoveries`

**Default: 1** | Type: integer | Min: 1

Maximum number of discovery operations that can run concurrently. When set to 1
(the default), behaviour is identical to the original single-discovery guard.
Setting to 2–3 allows pipelined discovery: when a new fittest creature is found,
its discovery can start immediately without waiting for the previous one to
complete. Each concurrent discovery runs on a separate heavy worker.

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

## 🔄 Discovery Replay Parameters

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

### `discoveryReplayRescoreBaseline`

**Default: false (true when verify is enabled)** | Type: boolean

When score verification is enabled, controls whether replay should report
baseline score drift (claimed vs actual) in the result payload. Automatically
enabled when `discoveryReplayVerifyScores` is `true`.

---

## 💾 Discovery Caching Parameters

These optional parameters enable caching of discovery results across evolution
runs.

| Option                     | Type     | Default                       | Description                                 |
| -------------------------- | -------- | ----------------------------- | ------------------------------------------- |
| `discoveryCacheDir`        | `string` | `undefined`                   | Base directory for discovery caching        |
| `discoveryFailureCacheDir` | `string` | `{discoveryCacheDir}/failure` | Directory for caching failed candidates     |
| `discoverySuccessCacheDir` | `string` | `{discoveryCacheDir}/success` | Directory for caching successful candidates |

> [!WARNING]
> Delete the cache directory when the training dataset changes materially.
> Replaying cached discoveries against a substantially different dataset can
> introduce stale structural signals that degrade training quality.

---

## 🐛 Discovery Debug Options

These options aid debugging and testing of the discovery pipeline.

### `discoveryBaseDirectory`

**Default: undefined** | Type: string

Custom base directory for discovery temporary files. By default, discovery uses
`.discovery` in the current working directory. Set this to redirect discovery
files to a different location for testing or debugging.

### `discoverySkipRecordPhase`

**Default: false** | Type: boolean

When enabled, skips the record phase if parquet files already exist in the
discovery directory. Useful for debugging to re-run analysis on previously
recorded data without re-recording.

### `discoveryDisableCleanup`

**Default: false** | Type: boolean

When enabled, preserves discovery temporary files (parquet files) after
discovery completes instead of cleaning them up. Useful for debugging to examine
the intermediate discovery data.

### `discoveryDisableEvaluationSummaryLogging`

**Default: false** | Type: boolean

Disables the internal evaluation summary logging. When set to `true`, the
library will not log the evaluation summary, allowing external code to handle
logging using the exported formatting utilities.

---

## 🎛️ Adaptive Mutation Thresholds

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

## 📉 Plateau Detection

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

## 🧪 Stability Adaptation

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

## ⚖️ Weight Regularisation

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

## ⚖️ Bias Regularisation

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

## 🌈 Ensemble Diversity

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

## ⚛️ Quantum Step

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

## 👥 Fine-Tune Population

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

## 🧵 Worker Thread Cap

Cap worker thread count based on available memory (Issue #1569). This is opt-in
— when `maxMemoryMB` is not set (or 0), behaviour is unchanged.

```ts
const config = createNeatConfig({
  threads: 16,
  workerThreadCap: {
    maxMemoryMB: 8192, // 8 GB memory budget
    estimatedMemoryPerWorkerMB: 2048, // 2 GB per worker (default)
  },
});
// Effective threads = min(16, floor(8192 / 2048)) = 4
```

| Field                        | Default      | Min | Description                                  |
| ---------------------------- | ------------ | --- | -------------------------------------------- |
| `maxMemoryMB`                | 0 (disabled) | 0   | Total memory budget in MB for worker threads |
| `estimatedMemoryPerWorkerMB` | 2048         | 1   | Estimated memory per worker in MB            |

When `maxMemoryMB > 0`, the effective thread count is:
`min(threads, max(1, floor(maxMemoryMB / estimatedMemoryPerWorkerMB)))`.

A warning is logged when the thread count is capped.

---

## ⚡ Worker Pool Partitioning

Issue #2243: Control how workers are split between fast tasks (fitness
evaluation/scoring) and heavy tasks (discovery, training, recording).

```ts
const config = createNeatConfig({
  threads: 8,
  heavyTaskWorkerCount: 2, // 2 heavy workers, 6 fast workers
});
```

| Field                  | Default | Min | Description                                 |
| ---------------------- | ------- | --- | ------------------------------------------- |
| `heavyTaskWorkerCount` | 2       | 1   | Workers dedicated to discovery and training |

Fast workers (`threads - heavyTaskWorkerCount`) handle fitness evaluation
exclusively and are never blocked by long-running discovery or training tasks.

**Partitioning is disabled when `threads <= 2`** — all workers share both roles
because there are too few workers to partition meaningfully.

**Validation (when `threads > 2`):** `heavyTaskWorkerCount` must be `< threads`
so at least one worker remains available for fast tasks.

---

## 📐 Output Range Constraints

Issue #1620: Constrain evolution outputs to domain-specific ranges. When
`outputRanges` is set, creatures whose outputs fall outside the specified
`[min, max]` range receive a quadratic fitness penalty proportional to the
excess, normalised by the range span.

```ts
const config = createNeatConfig({
  outputRanges: [
    { min: -0.35, max: 0.35 }, // 1st output: ±35%
    { min: -0.50, max: 0.50, penaltyWeight: 2 }, // 2nd output: ±50%, double penalty
  ],
});
```

Each element maps to one output neuron, in order. Outputs without a
corresponding entry are unconstrained.

| Field           | Default | Min | Description                                           |
| --------------- | ------- | --- | ----------------------------------------------------- |
| `min`           | —       | —   | Minimum expected output value (inclusive)             |
| `max`           | —       | —   | Maximum expected output value (inclusive, must ≥ min) |
| `penaltyWeight` | 1.0     | 0   | Multiplier for the out-of-range penalty               |

**Penalty formula** (per output, per record):

```
penalty = penaltyWeight × (excess / rangeSpan)²
```

where `excess = max(0, min - value) + max(0, value - max)` and
`rangeSpan = max - min`. The penalty is added to the evaluation error before
averaging, so it directly reduces the creature's fitness score.

When `outputRanges` is not specified (or empty), existing behaviour is
completely unchanged.

---

## 🎲 Data Fuzzing

Issue #1900: Training data fuzzing (noise injection) is a regularisation
technique that prevents networks from memorising exact training examples. Each
training iteration adds small random perturbations to inputs and optionally to
outputs, forcing the network to learn robust patterns rather than overfitting to
specific data points.

Pass as `dataFuzzing` in options.

```ts
const config = createNeatConfig({
  dataFuzzing: {
    enabled: true,
    inputNoiseScale: 0.02, // slightly noisier than default
    outputNoiseScale: 0.005, // gentle label smoothing
    noiseType: "gaussian",
  },
});
```

| Option             | Type                      | Default      | Description                                                                |
| ------------------ | ------------------------- | ------------ | -------------------------------------------------------------------------- |
| `enabled`          | `boolean`                 | `false`      | Whether data fuzzing is active                                             |
| `inputNoiseScale`  | `number`                  | `0.01`       | Standard deviation (Gaussian) or half-width (uniform) of input noise (0–1) |
| `outputNoiseScale` | `number`                  | `0`          | Noise on target outputs for label smoothing — 0 means disabled (0–1)       |
| `noiseType`        | `"gaussian" \| "uniform"` | `"gaussian"` | Distribution used for noise generation                                     |

> [!TIP]
> Start with the defaults (`inputNoiseScale: 0.01`, `outputNoiseScale: 0`) and
> increase gradually. Too much noise slows convergence; too little has no
> regularisation effect. Gaussian noise is generally preferred because it
> concentrates most perturbations near zero.

---

## 🔀 Cross-Validation

Issue #1865: K-fold cross-validation evaluates creatures on held-out data folds
during evolution, reducing overfitting to a single train/test split. Each
generation, training data is divided into `k` folds; the creature trains on
`k-1` folds and is evaluated on the remaining fold. The validation error guides
early stopping and selection.

Pass as `crossValidation` in options.

```ts
const config = createNeatConfig({
  crossValidation: {
    enabled: true,
    folds: 5,
    validationEarlyStopping: true,
  },
});
```

| Option                    | Type      | Default | Description                                                                  |
| ------------------------- | --------- | ------- | ---------------------------------------------------------------------------- |
| `enabled`                 | `boolean` | `false` | Whether cross-validation is enabled                                          |
| `folds`                   | `integer` | `5`     | Number of folds — 1 preserves single-split behaviour (1–20)                  |
| `validationEarlyStopping` | `boolean` | `true`  | Use validation fold performance for early stopping instead of training error |

> [!TIP]
> 5 folds is a good starting point. Higher fold counts give more reliable
> estimates at the cost of more training time per generation. When
> `validationEarlyStopping` is enabled, backpropagation stops when the
> validation fold error stops improving, which helps prevent overfitting.

---

## 🧬 Hyperparameter Evolution

Issue #1863: Instead of using fixed hyperparameters for the entire population,
each creature carries its own learning rate, mutation rates, and regularisation
strength. These evolve alongside topology and weights — creatures whose
hyperparameters suit the problem achieve higher fitness and propagate their
settings to offspring.

Pass as `hyperparameterEvolution` in options.

```ts
const config = createNeatConfig({
  hyperparameterEvolution: {
    enabled: true,
    minLearningRate: 0.0001,
    maxLearningRate: 0.1,
  },
});
```

### Bounds Configuration

| Option                      | Type      | Default  | Description                                                 |
| --------------------------- | --------- | -------- | ----------------------------------------------------------- |
| `enabled`                   | `boolean` | `false`  | Whether per-creature hyperparameter evolution is active     |
| `minLearningRate`           | `number`  | `0.0001` | Lower bound for per-creature learning rate                  |
| `maxLearningRate`           | `number`  | `0.1`    | Upper bound for per-creature learning rate                  |
| `minWeightPerturbation`     | `number`  | `0.1`    | Lower bound for weight perturbation scale                   |
| `maxWeightPerturbation`     | `number`  | `2.0`    | Upper bound for weight perturbation scale                   |
| `maxRegularisationStrength` | `number`  | `0.1`    | Upper bound for L1/L2 regularisation strength               |
| `mutationStdDev`            | `number`  | `0.1`    | Standard deviation for Gaussian mutation of hyperparameters |

### Per-Creature Hyperparameters

Each creature evolves these values within the configured bounds:

| Hyperparameter             | Default | Description                                        |
| -------------------------- | ------- | -------------------------------------------------- |
| `learningRate`             | `0.01`  | Backpropagation learning rate                      |
| `addNeuronRate`            | `0.1`   | Probability of adding a neuron during mutation     |
| `addConnectionRate`        | `0.2`   | Probability of adding a connection during mutation |
| `weightPerturbationScale`  | `1.0`   | Weight perturbation magnitude scaling factor       |
| `l1RegularisationStrength` | `0`     | L1 regularisation strength for backpropagation     |
| `l2RegularisationStrength` | `0`     | L2 regularisation strength for backpropagation     |

---

## 🎲 MCMC Acceptance Criterion

Issue #2199: Markov Chain Monte Carlo (MCMC) acceptance applies the
[Metropolis-Hastings](https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm)
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

```ts
const config = createNeatConfig({
  mcmc: {
    enabled: true,
    initialTemperature: 1.0,
    coolingRate: 0.995,
  },
});
```

| Option                 | Type      | Default | Description                                                         |
| ---------------------- | --------- | ------- | ------------------------------------------------------------------- |
| `enabled`              | `boolean` | `false` | Whether MCMC acceptance is active                                   |
| `initialTemperature`   | `number`  | `1.0`   | Starting temperature for Metropolis-Hastings acceptance             |
| `minTemperature`       | `number`  | `0.01`  | Floor temperature to prevent acceptance probability reaching zero   |
| `coolingRate`          | `number`  | `0.995` | Multiplicative cooling factor applied per generation                |
| `targetAcceptanceRate` | `number`  | `0.234` | Optimal acceptance rate for high-dimensional MCMC                   |
| `adjustmentRate`       | `number`  | `0.02`  | Rate at which temperature adapts toward the target acceptance rate  |
| `toleranceRate`        | `number`  | `0.05`  | Tolerance band around target rate within which no adjustment occurs |

**How it works:**

- **Improving mutations** (lower cost) are always accepted
- **Worsening mutations** are accepted with probability
  `exp(-deltaCost / temperature)`
- **Topology mutations** (add/remove nodes or connections) are always accepted
  unconditionally, since discrete structural changes do not lend themselves to
  continuous cost comparison
- **Adaptive tuning** (Issue #2201): after each generation, the smoothed
  acceptance rate is compared to the target. If acceptance is too high the
  temperature decreases; if too low it increases

> [!TIP]
> MCMC works well alongside plateau detection. Plateau detection adjusts _how
> much_ mutation happens, while MCMC temperature adjusts _which mutations
> stick_. Enable both for robust exploration-exploitation balance.

---

## 📊 Adaptive Population Sizing

Issue #1863: Automatically adjusts population size based on species diversity
metrics. When diversity drops below a threshold the population grows to
encourage exploration. When diversity is high and fitness is stagnating, the
population can shrink to focus resources on the most promising individuals.

Issue #2316: Added worker-aware minimum floor to ensure enough creatures per
worker for good CPU utilisation at production scale. On machines with many cores
(e.g. 32-core production clusters), the default population of 50 means each
worker gets only ~1.5 creatures — too few for even work distribution.

Pass as `adaptivePopulation` in options.

```ts
const config = createNeatConfig({
  populationSize: 100, // starting size
  adaptivePopulation: {
    enabled: true,
    minPopulationFraction: 0.5, // never below 50 creatures
    maxPopulationFraction: 2.0, // can grow up to 200 creatures
    minCreaturesPerWorker: 3, // ensure enough work per worker
  },
});
```

| Option                   | Type      | Default | Description                                                               |
| ------------------------ | --------- | ------- | ------------------------------------------------------------------------- |
| `enabled`                | `boolean` | `false` | Whether adaptive population sizing is active                              |
| `minPopulationFraction`  | `number`  | `0.5`   | Minimum population as a fraction of `populationSize` (0–1)                |
| `maxPopulationFraction`  | `number`  | `2.0`   | Maximum population as a fraction of `populationSize`                      |
| `lowDiversityThreshold`  | `number`  | `0.3`   | Diversity level below which population grows (0–1)                        |
| `highDiversityThreshold` | `number`  | `0.8`   | Diversity level above which population may shrink during stagnation (0–1) |
| `adjustmentRate`         | `number`  | `0.1`   | Maximum population change per generation as a fraction (0–1)              |
| `minCreaturesPerWorker`  | `number`  | `3`     | Worker-aware floor: minimum creatures per worker thread (0 to disable)    |

---

## ⚡ Parallel Evaluation

Issue #1862: Controls how creatures are distributed across workers during
fitness evaluation. Topology-aware grouping ensures creatures with identical
network structure are evaluated on the same worker, maximising WASM compilation
cache hits and improving evaluation throughput.

Pass as `parallelEvaluation` in options.

```ts
const config = createNeatConfig({
  parallelEvaluation: {
    topologyGrouping: true, // default
    maxConcurrentEvaluations: 4, // cap at 4 workers for evaluation
  },
});
```

| Option                     | Type      | Default   | Description                                                     |
| -------------------------- | --------- | --------- | --------------------------------------------------------------- |
| `topologyGrouping`         | `boolean` | `true`    | Group creatures by topology hash to improve WASM cache hit rate |
| `maxConcurrentEvaluations` | `integer` | `0` (all) | Maximum workers for evaluation — 0 means use all available      |

> [!TIP]
> Keep `topologyGrouping` enabled unless you have a specific reason to disable
> it. Topology grouping improves WASM cache utilisation by batching same-shape
> creatures together. Set `maxConcurrentEvaluations` when you need to reserve
> workers for concurrent training or discovery tasks.

---

## 📝 Logging and Reproducibility

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

> [!TIP]
> Always set `seed`, `sparseRatio`, and `globalBreedingRate` to fixed values
> when running reproducibility experiments. Both `sparseRatio` and
> `globalBreedingRate` default to random values, which will produce different
> results between runs even when a `seed` is provided if these are left as
> defaults.

### `rng`

**Default: undefined** | Type: RandomNumberGenerator

Custom random number generator instance. Takes precedence over `seed` when both
are provided.

---

## ✅ Validation Rules

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

## 🍳 Recipes

### ⚡ Fast Prototyping

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

### 🏭 Production Training

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

### 🔬 Research / Reproducibility

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

### 🔁 Time-Series / Recurrent

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

### 🪶 Minimal Complexity

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

### 🛡️ Maximum Generalisation

Combine noise injection and cross-validation to fight overfitting:

```ts
const config = createNeatConfig({
  populationSize: 100,
  iterations: 5_000,
  targetError: 0.02,
  dataFuzzing: {
    enabled: true,
    inputNoiseScale: 0.02,
    noiseType: "gaussian",
  },
  crossValidation: {
    enabled: true,
    folds: 5,
  },
});
```

### 🧬 Self-Tuning Evolution

Let hyperparameters and population size evolve alongside the creatures:

```ts
const config = createNeatConfig({
  populationSize: 100,
  iterations: 10_000,
  targetError: 0.01,
  hyperparameterEvolution: {
    enabled: true,
  },
  adaptivePopulation: {
    enabled: true,
    lowDiversityThreshold: 0.3,
    highDiversityThreshold: 0.8,
    minCreaturesPerWorker: 3, // ensure enough work per worker
  },
});
```

## 👀 See Also

- [Performance Tuning](./PERFORMANCE_TUNING.md) — Operational guide for WASM
  caches, thread pools, memory management, and scaling
- [Performance Research](./PERFORMANCE_RESEARCH.md) — WASM migration research
  and benchmark learnings
