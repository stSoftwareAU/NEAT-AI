# NEAT Neural Network for DenoJS

<p align="left">
  <img width="100" height="100" src="docs/logo.png" align="right">
This project is a practical implementation of a neural network based on the NEAT (NeuroEvolution of Augmenting Topologies) algorithm, written in DenoJS using TypeScript, with additional features such as error-guided discovery, memetic evolution, and distributed workflows.
</p>

## Terminology

We keep the tone playful, but every nickname maps to a mainstream
machine-learning idea:

- **Creatures** are simply individual neural networks/genomes inside a NEAT
  population, as described in the original NEAT paper by
  [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).
- **Memetic evolution** refers to the well-studied combination of evolutionary
  search plus local gradient descent, also called a
  [memetic algorithm](https://en.wikipedia.org/wiki/Memetic_algorithm).
- **CRISPR injections** describe targeted gene edits inspired by the real-world
  [CRISPR gene editing technique](https://www.nature.com/scitable/topicpage/crispr-cas9-a-precise-tool-for-33169884/);
  in practice we add hand-crafted synapses/neurons.
- **Grafting** is crossover between incompatibly shaped genomes, similar to the
  [island-model speciation strategies](https://en.wikipedia.org/wiki/Island_model)
  used in evolutionary algorithms.

If you spot another fun label, expect it to be backed by a reference to the
standard term the first time it appears.

## Feature Highlights

1. **Extendable Observations**: The observations can be extended over time
   because input and output features are identified by stable UUIDs in the
   exported representation, rather than only by positional indices. This
   prevents the need to restart the evolution process as new observations are
   added, and makes it practical to evolve creatures on multiple machines and
   then recombine them, much like NEAT's historical marking for genes
   [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).

2. **Distributed Training**: Training and evolution can be run on multiple
   independent nodes. The best-of-breed creatures can later be combined on a
   centralized controller node, mirroring the
   [island model](https://en.wikipedia.org/wiki/Island_model) used in
   evolutionary algorithms. This feature allows for distributed computing and
   potentially faster training times, enhancing the efficiency of the learning
   process.

3. **Life Long Learning**: Unlike many pre-trained neural networks, this project
   is designed for continuous learning, making it adaptable in changing
   environments. In long-running deployments (for example, generating fresh
   training data each day from many years of market and company data), the same
   population can keep training and adapting as time goes on. New observations
   can be added over weeks or months by widening the dataset and introducing new
   UUID-indexed features, without throwing away existing creatures. This
   supports continual learning in the spirit of
   [continual learning](https://en.wikipedia.org/wiki/Continual_learning), while
   still relying on your training data to keep past knowledge represented.

4. **Efficient Model Utilisation**: Once trained, the current best model can be
   utilised efficiently by calling the `activate` function. This runs a single
   forward pass that maps inputs to outputs, allowing for quick and easy
   deployment of the trained model.

5. **Unique Squash Functions**: The neural network supports unique squash
   functions such as IF, MAX and MIN. These functions provide more options for
   the activation function, which can lead to different network behaviours,
   offering a wider range of potential solutions. More about
   [Activation Functions](https://en.wikipedia.org/wiki/Activation_function).

6. **Neuron Pruning**: Neurons whose activations don't vary during training are
   removed, and the biases in the associated neurons are adjusted. This feature
   optimizes the network by reducing redundancy and computational load. More
   about
   [Pruning (Neural Networks)](https://en.wikipedia.org/wiki/Pruning_(neural_networks)).

7. **CRISPR**: Allows injection of genes into a population of creatures during
   evolution. This feature can introduce new traits and potentially improve the
   performance of the population. More about
   [CRISPR](https://en.wikipedia.org/wiki/CRISPR).

8. **Grafting**: If parents aren't "genetically compatible", then the "grafting"
   algorithm from one parent to another parent onto the child will be used. This
   allows for species from islands to interbreed, preserving diversity in the
   same spirit as cross-island migration in
   [island-model evolution](https://en.wikipedia.org/wiki/Island_model).

9. **Memetic Evolution**: The algorithm can now record and utilize the biases
   and weights of the fittest creatures to fine-tune future generations. This
   process, inspired by the concept of memes, allows the system to "remember"
   and build upon successful traits, enhancing the evolutionary process. Learn
   more about
   [Memetic Algorithms](https://en.wikipedia.org/wiki/Memetic_algorithm).

10. **Error-Guided Structural Evolution**: Dynamically identifies and creates
    new synapses by analysing neuron activations and errors. This targeted
    structural adaptation improves performance by explicitly reducing
    neuron-level errors, blending evolutionary topology adjustments with
    error-driven learning. The Rust discovery engine can currently reconstruct
    hidden neurons using standard squashes including ReLU, GELU, ELU, SELU,
    Softplus, LOGISTIC (sigmoid), and TANH.

    Instead of relying purely on random structural mutations (as many NEAT
    implementations do), a dedicated Rust module performs GPU-accelerated
    analysis and proposes a focused set of structural candidates. In our own
    workloads, discovery runs typically uncover small but meaningful
    improvements (around 0.5–3% per run) that accumulate over many iterations
    without hand-editing architectures.

    **Note**: Error-Guided Structural Evolution now relies entirely on the
    [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) Rust
    extension library. If the library is not available, the discovery phase is
    skipped wholesale; there is no TypeScript fallback.

11. **[Visualization](https://stsoftwareau.github.io/NEAT-AI/index.html)**
12. **Discovery Integration Guide**: Step-by-step instructions for running
    discovery via `Creature.discoveryDir()` are available in the
    [DiscoveryDir guide](./docs/DiscoveryDir.md).
13. **Continuous Incremental Discovery**: For distributed, multi-machine
    discovery workflows that accumulate small improvements over time, see the
    [Discovery Guide](./docs/DISCOVERY_GUIDE.md).

## Documentation

For detailed documentation, see the [docs/](./docs/) directory:

- **[Discovery Guide](./docs/DISCOVERY_GUIDE.md)**: Complete guide to
  distributed, multi-machine discovery workflows
- **[DiscoveryDir API](./docs/DiscoveryDir.md)**: Technical API reference for
  `Creature.discoveryDir()` and data preparation
- **[GPU Acceleration](./docs/GPU_ACCELERATION.md)**: GPU acceleration for
  discovery on macOS using Metal

## Comparison with Other AI Approaches

Want to understand how NEAT compares to traditional neural networks, CNNs, RNNs,
and modern LLMs? See our comprehensive [COMPARISON.md](./COMPARISON.md) document
which explains:

- What we've implemented and how it works
- Pros and cons of our NEAT approach vs traditional methods
- Our unique innovations (memetic evolution, error-guided discovery, etc.)
- Shortcomings and future work opportunities with references

This comparison helps you understand when to use NEAT vs other approaches and
identifies areas for future development.

## Usage

This project is designed to be used in a DenoJS environment. Please refer to the
[DenoJS documentation](https://deno.land/manual) for setup and usage
instructions.

## Discovery Integration

Discovery enables **continuous incremental improvement** of neural networks
through automated structural analysis. Each discovery run finds small
improvements (0.5-3%), which accumulate over time through repeated iterations.

### Quick Start

```typescript
// Single discovery iteration
const result = await creature.discoveryDir(dataDir, {
  discoveryRecordTimeOutMinutes: 1,
  discoveryAnalysisTimeoutMinutes: 10,
  discoveryMinImprovementPercentage: 0.01, // Accept 1%+ improvements
});

if (result.improvement) {
  console.log(`Found ${result.improvement.changeType} improvement!`);
  // Use improved creature for next iteration
}
```

### Documentation

- **[Discovery Guide](./docs/DISCOVERY_GUIDE.md)**: Complete guide to
  distributed, multi-machine discovery workflows
- **[DiscoveryDir API](./docs/DiscoveryDir.md)**: Technical API reference and
  data preparation

### Evaluation Summary Logging

By default, the library logs evaluation summaries with the `[DiscoveryRunner]`
prefix. To avoid duplicate logging when your application also logs evaluation
results:

1. **Disable library logging**: Set
   `discoveryDisableEvaluationSummaryLogging: true` in your options
2. **Use exported formatting utilities**: Import `formatErrorDelta`,
   `formatExpected`, and `formatPercentWithSignificantDigits` from the discovery
   module to format summaries consistently

```typescript
import { formatErrorDelta, formatExpected } from "./mod.ts";

const result = await creature.discoveryDir(dataDir, {
  discoveryDisableEvaluationSummaryLogging: true, // Disable library logging
  // ... other options
});

// Log summaries yourself using the exported formatters
if (result.evaluations) {
  for (const summary of result.evaluations) {
    console.log(
      `Candidate: ${summary.changeType}, improvement: ${
        formatErrorDelta(summary.errorDeltaPct ?? 0)
      }`,
    );
  }
}
```

Discovery is designed for **continuous operation** across multiple machines,
accumulating improvements over hundreds of iterations. See the
[Discovery Guide](./docs/DISCOVERY_GUIDE.md) for real-world workflows and
production-tuned configurations.

### Discovery Failure Cache

When running discovery iteratively with a stable training dataset, you can
enable failure caching to avoid re-evaluating candidates that previously failed
to improve the creature's score. This significantly speeds up discovery runs by
skipping known-failing candidates.

```typescript
const result = await creature.discoveryDir(dataDir, {
  discoveryFailureCacheDir: ".discovery/failure-cache",
  // ... other options
});
```

**How it works:**

1. After evaluating candidates, those that fail to improve the score are cached
2. On subsequent runs, cached candidates are skipped before evaluation
3. Cache keys use weight/bias magnitude (exponent only), so only significant
   changes trigger re-evaluation
4. Delete the cache directory when your training dataset changes

**When to use:**

- Training dataset changes infrequently (e.g., once a day)
- Running discovery repeatedly on the same creature
- Want to reduce wasted computation on known-failing candidates

**Cache key design:**

- **Neuron removal** (`remove-neuron`, `remove-low-impact`): Uses just the
  neuron UUID - if removal failed once, it won't succeed until the creature
  structure changes significantly
- **Synapse removal** (`remove-synapse`): Uses just the from/to neuron UUIDs
- **Other candidates**: Uses the exponential component of weights/biases in
  scientific notation - weights like `0.123` and `0.234` (both `e-1`) map to the
  same key, while `0.001` (`e-3`) and `0.1` (`e-1`) map to different keys

### Discovery Candidate Category Limits

You can control the minimum number of candidates evaluated per category. This is
useful when certain mutation types are more successful for your use case. For
example, if neuron removal is working well but adding neurons isn't, you can
increase the removal candidates and reduce add-neurons candidates.

```typescript
const result = await creature.discoveryDir(dataDir, {
  discoveryMinCandidatesPerCategory: {
    addNeurons: 0, // Skip add-neurons candidates
    addSynapses: 1, // Minimum 1 add-synapses candidate
    changeSquash: 1, // Minimum 1 change-squash candidate
    removeLowImpact: 10, // Evaluate 10 removal candidates
  },
  // ... other options
});
```

**Default values:**

- `addNeurons`: 1
- `addSynapses`: 1
- `changeSquash`: 1
- `removeLowImpact`: 3

Higher values mean more candidates of that type will be evaluated. Set to 0 to
skip a category entirely.

### Forced Focus Overrides

The discovery recorder now honours an optional `discoveryFocusNeuronUUIDs`
override. When supplied, the recorder prioritises those hidden/output neuron
UUIDs instead of sampling by error, giving you deterministic reproduction of a
known gap. Each entry must match a neuron in the crippled creature.

To see the override in action, run the sibling
[`NEAT-AI-Examples`](../NEAT-AI-Examples) repository. The
`discovery/discover_missing_neuron.ts` script generates a wide, long synthetic
dataset, removes a known neuron, and invokes `Creature.discoveryDir()` with a
forced focus list so you can reproduce production time-outs safely:

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi \
  ../NEAT-AI-Examples/discovery/discover_missing_neuron.ts
```

The example writes synthetic assets to a hidden `.synthetic-discovery/`
directory (ignored by git) and logs extended diagnostics whenever the Rust
recorder flushes or hits the time-out path. Use it as the starting point for
debugging “Invalid string length” failures without touching live workloads.

### Discovery Cost-of-Growth Gate

Discovery candidates are now triaged using the configured `costOfGrowth` setting
before they reach the evaluator. Each new synapse consumes `1 x
costOfGrowth`,
while every new neuron consumes roughly `3 x costOfGrowth` (two synapses plus
the neuron). Candidates whose expected error reduction is smaller than their
structural cost are skipped entirely. This keeps discovery focused on proposals
that can actually repay the growth penalty and prevents logs from being flooded
with meaningless `+0.000%` deltas.

**Note:** The following candidate types are excluded from the cost-of-growth
threshold check:

- **Squash changes (`change-squash`)**: Don't add structural complexity (no new
  synapses or neurons). They only modify the activation function of existing
  neurons, so there is no growth cost to penalise.

- **Removal candidates (`remove-neuron`, `remove-synapse`,
  `remove-low-impact`)**: Don't add structural complexity - they remove it. They
  improve score by reducing complexity, not by reducing error. Removing elements
  that return a similar score will improve the creature's score.

## Enabling the Rust Discovery Module

The Rust FFI extension shipped via
[NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) provides
the accelerated structural hints used by `discoveryDir()`. To enable it:

1. Clone the repository alongside this project and build/install the library:

   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git
   ../NEAT-AI-Discovery/scripts/runlib.sh
   ```

   The `runlib.sh` script automatically:
   - Installs Rust and Cargo if missing (no sudo required)
   - Builds the library in release mode
   - Installs it to `~/.cargo/lib/` with version tracking
   - Signs it on macOS for FFI compatibility

2. Alternatively, export an explicit path to the library:

   ```bash
   export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/libneat_ai_discovery.dylib"
   ```

3. Grant FFI permissions and validate the installation:

   ```bash
   deno run --allow-env --allow-ffi --allow-read scripts/check_discovery.ts
   ```

4. In your application, guard discovery calls with `isRustDiscoveryEnabled()` so
   that controllers fail fast when the module is unavailable.

When the library cannot be resolved, set `NEAT_RUST_DISCOVERY_OPTIONAL=true` in
environments where skipping discovery should not abort the worker. Otherwise,
treat a missing module as a deployment error and halt the job.

## Deployment Checklist

Before committing code changes, ensure you complete the following steps:

1. **Run quality checks in both repositories:**
   ```bash
   # In NEAT-AI-Discovery
   cd ../NEAT-AI-Discovery
   ./quality.sh

   # In NEAT-AI
   cd ../NEAT-AI
   ./quality.sh
   ```

2. **Increment version numbers:**
   - **NEAT-AI**: Update `deno.json` version field (e.g., `0.204.1` → `0.204.2`)
   - **NEAT-AI-Discovery**: Update `Cargo.toml` version field (e.g., `0.1.41` →
     `0.1.42`)

3. **Verify all tests pass** in both repositories before committing.

These steps ensure code quality, proper versioning, and that all tests pass
before deployment.

## Contributions

Contributions are welcome. Please submit a pull request or open an issue to
discuss potential changes/additions.

## License

This project is licensed under the terms of the Apache License 2.0. For the full
license text, please see [LICENSE](./LICENSE)

[![Built with the Deno Standard Library](https://raw.githubusercontent.com/denoland/deno_std/main/badge.svg)](https://deno.land/std)

[![codecov](https://codecov.io/github/stSoftwareAU/NEAT-AI/graph/badge.svg?token=DZ3R9KJGKB)](https://codecov.io/github/stSoftwareAU/NEAT-AI)
