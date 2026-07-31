# 🧬 What NEAT-AI Implements: Standard NEAT vs NEAT-AI Extensions

Part of the [Comparison hub](../../COMPARISON.md). This page draws the line
between **standard [NEAT](../../AGENTS.md#-terminology)** (the 2002 algorithm)
and the **[NEAT-AI](../../AGENTS.md#-terminology)** extensions built on top, so
a reader never confuses what the original algorithm did with what this
repository adds.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule in AGENTS.md](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

## 🔬 Standard NEAT machinery (Stanley & Miikkulainen, 2002)

These items come directly from the
[original NEAT paper](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).
NEAT-AI inherits them as the evolutionary substrate.

- ✅ **Evolutionary Topology Search** _(standard NEAT)_: Networks evolve their
  structure through genetic operations (mutation, crossover).
- ✅ **Speciation** _(standard NEAT)_: Networks are grouped by similarity to
  protect innovation and prevent premature convergence.
- ✅ **Historical Marking** _(standard NEAT)_: Tracks gene history for
  compatible crossover between different topologies.
- ✅ **Genetic Operators** _(standard NEAT)_:
  - Mutation: add/remove neurons and connections, modify weights/biases.
  - Crossover: breeding between compatible parents.
  - Selection: multiple strategies (fitness proportionate, tournament, power).
- ✅ **Fitness Sharing** _(standard NEAT)_: Raw fitness is divided by species
  size so dominant species don't starve smaller niches. NEAT-AI adds per-species
  breeding quotas on top — see the NEAT-AI extensions list below.

## 🚀 NEAT-AI extensions — training methods (beyond the 2002 paper)

Everything below is a NEAT-AI extension added on top of standard NEAT — most of
these have no counterpart in the original 2002 algorithm. Where a feature links
to a dedicated guide, the contrast with standard NEAT is documented there.

- ✅ **Backpropagation** _(NEAT-AI extension)_: Full gradient-based weight
  optimisation, which standard NEAT does not include. Implemented with:
  - Mini-batch gradient descent (configurable batch sizes)
  - Adaptive learning rate strategies (fixed, decay, adaptive)
  - Weight and bias adjustment with configurable limits
  - Sparse training with intelligent neuron selection
- ✅ **Memetic Evolution** _(NEAT-AI extension)_: Records successful weight
  patterns and reuses them in later generations, following the
  [memetic algorithm](https://en.wikipedia.org/wiki/Memetic_algorithm) approach.
  Standard NEAT has no memetic step; in NEAT-AI's internal benchmarks this
  hybrid step improves convergence over evolution alone.
- ✅ **Error-Guided Structural Evolution** _(NEAT-AI extension)_:
  GPU-accelerated discovery of beneficial structural changes. Standard NEAT
  performs structural mutation uniformly at random; NEAT-AI guides it with
  measured error data — see [DISCOVERY_GUIDE.md](../DISCOVERY_GUIDE.md).
- ✅ **Sparse Training** _(NEAT-AI extension)_: Configurable neuron selection
  strategies (random, output-distance, error-weighted) for efficiency.
- ✅ **Batch Processing** _(NEAT-AI extension)_: Mini-batch gradient descent
  with configurable batch sizes.
- ✅ **Early Stopping** _(NEAT-AI extension)_: Enhanced early stopping with
  patience and improvement thresholds.
- ✅ **Predictive Coding** _(NEAT-AI extension)_: Optional training paradigm
  based on [Rao & Ballard (1999)](https://www.nature.com/articles/nn0199_79)
  that uses iterative inference settling and local Hebbian learning rules.
  Configurable via `PredictiveCodingConfig` with inference steps, learning rate,
  and energy convergence thresholds. See
  [PREDICTIVE_CODING.md](../PREDICTIVE_CODING.md) for architecture details and
  the contrast with standard NEAT (which has no equivalent).
- ✅ **Dropout Regularisation** _(NEAT-AI extension)_: True
  [inverted dropout](https://arxiv.org/abs/1207.0580) during training — randomly
  disables a configurable fraction of hidden neurons per forward pass and scales
  remaining activations by 1/(1−p) so inference runs unchanged. Input and output
  neurons are never dropped.
- ✅ **L1/L2 Weight & Bias Regularisation** _(NEAT-AI extension)_: During
  backpropagation, applies L2 weight decay (`w *= (1 − lr·λ₂)`) and L1
  soft-thresholding to drive small weights to exactly zero, promoting sparsity.
  Mirrors the same decay for biases. Standard NEAT has no gradient step at all
  and therefore no weight decay.
- ✅ **K-Fold Cross-Validation** _(NEAT-AI extension)_: Splits training data
  into k folds, trains on k−1 folds and validates on the held-out fold. Fitness
  is the average validation error across all folds, reducing overfitting and
  producing more robust fitness estimates. Configurable fold count (1–20) with
  automatic fallback to single-split when data is insufficient.
- ✅ **Gradient Accumulation Normalisation** _(NEAT-AI extension)_: Optional
  sqrt-scaling for gradient accumulation in high fan-out neurons, preventing
  neurons with many downstream connections from receiving disproportionately
  large error signals.
- ✅ **Synthetic Synapse Training** _(NEAT-AI extension)_: Temporarily densifies
  inter-layer connectivity during backpropagation by adding zero-weight synapses
  between adjacent topological layers. After training, near-zero synapses are
  pruned and only useful connections are retained — addressing the inherent
  sparseness of NEAT-evolved networks compared to conventional
  [dense layers](https://en.wikipedia.org/wiki/Dense_layer). Opt-in via
  `syntheticSynapses: true` in the training configuration.
- ✅ **MCMC Mutation Acceptance** _(NEAT-AI extension)_: Uses the
  [Metropolis-Hastings](https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm)
  criterion for mutation acceptance. Standard NEAT accepts all mutations
  unconditionally; NEAT-AI accepts worsening mutations only with a
  temperature-dependent probability so the population can escape local optima
  early and converge later. Includes adaptive temperature tuning toward the
  theoretically optimal acceptance rate (~23.4%, Roberts et al. 1997). The
  cooling schedule is also coupled to a live diversity signal: when species
  count collapses or within-species crowding rises, the temperature is reheated
  to restore exploration (`diversityAwareMCMC` block). Opt-in via
  `mcmc: { enabled: true }`.
- ✅ **Muon-Style Orthogonalised Gradient Updates** _(NEAT-AI extension)_:
  Optional Newton-Schulz polynomial iteration applied to per-neuron gradient
  matrices during backpropagation, decorrelating update directions for improved
  training stability. Inspired by the DeepSeek V4 approach. Opt-in via
  `gradientOrthogonalisation: "muon"` in `BackPropagationArguments` (default
  `"none"`).

## ✨ NEAT-AI extensions — architecture, identity, and tooling

- ✅ **UUID-Based Indexing** _(NEAT-AI extension)_: Extensible observations
  without restarting evolution — new input features can be added dynamically by
  extending the historical-marking idea from
  [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)
  to UUID-keyed neuron identity. Standard NEAT identifies genes by integer
  innovation numbers only. (NEAT-AI keeps a stable persisted UUID per neuron for
  identity and a runtime integer `id` for hot-loop speed — see
  [`src/architecture/NeuronId.ts`](../../src/architecture/NeuronId.ts).)
- ✅ **Distributed Evolution** _(NEAT-AI extension)_: Multi-node training with
  centralised combination of best-of-breed creatures, similar to the
  [island model](https://en.wikipedia.org/wiki/Island_model). Standard NEAT is
  single-machine.
- ✅ **Lifelong Learning** _(NEAT-AI extension)_: Continuous adaptation via
  ongoing evolution and backpropagation. In long-running deployments (for
  example, generating fresh training data each day from many years of financial,
  market, or company reporting data), the same population can keep training and
  adapting as new samples and new features arrive. This supports
  [continual learning](https://en.wikipedia.org/wiki/Continual_learning) while
  still relying on your training data mix to keep past behaviour represented.
- ✅ **CRISPR Gene Injection** _(NEAT-AI extension)_: Targeted gene insertion
  during evolution to introduce specific traits, inspired by
  [CRISPR-Cas9 gene editing](https://www.nature.com/scitable/topicpage/crispr-cas9-a-precise-tool-for-33169884/).
- ✅ **Grafting** _(NEAT-AI extension)_: Cross-species breeding algorithm for
  genetically incompatible parents that preserves diversity like cross-island
  migration in the [island model](https://en.wikipedia.org/wiki/Island_model).
  Standard NEAT does not breed across speciation boundaries.
- ✅ **Neuron Pruning** _(NEAT-AI extension)_: Automatic removal of neurons
  whose activations don't vary during training, echoing established
  [network pruning](https://en.wikipedia.org/wiki/Pruning_(neural_networks))
  practice.
- ✅ **GPU-Accelerated Discovery** _(NEAT-AI extension)_: Cross-platform GPU
  support via [wgpu](https://wgpu.rs/) abstraction — Metal on macOS, Vulkan on
  Linux, DX12 on Windows — with automatic CPU fallback when no compatible GPU is
  detected.
- ✅ **Discovery Caching** _(NEAT-AI extension)_: Success and failure caching
  for discovery candidates with age-based and size-based eviction,
  cache-informed multi-neuron removal candidates, and supplemental candidate
  building from historical data.
- ✅ **Disk Space Monitoring** _(NEAT-AI extension)_: Pre-flight and runtime
  disk space checks during discovery to gracefully warn or abort when disk space
  is insufficient.
- ✅ **Adaptive Quantum Steps** _(NEAT-AI extension)_: `QuantumStepConfig`
  provides adaptive step sizing during memetic fine-tuning — larger steps when
  far from the optimum and smaller steps during convergence.
- ✅ **Unique Activation Functions** _(NEAT-AI extension)_: IF, MAX, MIN, and
  other non-standard squashes that enable different network behaviours, akin to
  the broader family of
  [activation functions](https://en.wikipedia.org/wiki/Activation_function).
  Standard NEAT typically restricts itself to sigmoid.
- ✅ **Improved Aggregate Gradient Flow** _(NEAT-AI extension)_: MAXIMUM and
  MINIMUM aggregate functions distribute partial error signals to runner-up
  connections within a proximity threshold (15%), preventing dead gradient paths
  while preserving dominance of the winning connection.
- ✅ **Transfer Learning** _(NEAT-AI extension)_: Checkpoint export/import
  system with UUID-based neuron and synapse mapping between creatures with
  different input/output configurations. Supports weight freezing for
  fine-tuning imported hidden layers and population seeding with pre-trained
  creatures. Standard NEAT has no transfer-learning concept.
- ✅ **ONNX Format Export** _(NEAT-AI extension)_: Exports trained creatures to
  the [ONNX](https://onnx.ai/) binary format for interoperability with standard
  ML tooling. Converts creature topology to ONNX computational graphs with
  compatibility checking for unsupported features (aggregate functions,
  recurrent connections).
- ✅ **Hyperparameter Self-Adaptation** _(NEAT-AI extension)_: Per-creature
  evolvable hyperparameters (learning rate, mutation rates, regularisation
  strength) subject to Gaussian mutation and weighted-average crossover,
  reducing the need for manual hyperparameter tuning.
- ✅ **Adaptive Population Sizing** _(NEAT-AI extension)_: Automatically adjusts
  population size based on species diversity metrics — growing the population
  when diversity is low (premature convergence) and shrinking it during
  high-diversity stagnation.
- ✅ **Parallel Batch Creature Evaluation** _(NEAT-AI extension)_:
  Topology-aware grouping clusters same-structure creatures in the evaluation
  queue to maximise WASM compilation cache hits across workers, with
  configurable concurrency limits.
- ✅ **Advanced Breeding Strategies** _(NEAT-AI extension)_: Multiple breeding
  strategies for genetically incompatible creatures, including input-weight
  cosine similarity for neuron alignment, subgraph transplantation for
  [horizontal gene transfer](https://en.wikipedia.org/wiki/Horizontal_gene_transfer),
  and diversity-driven breeding for cross-population pairing. Standard NEAT
  refuses crossover between incompatible parents.
- ✅ **WASM Panic Recovery** _(NEAT-AI extension)_: Graceful handling of WASM
  unreachable panics during evolution. Creatures that trigger WASM traps are
  excluded from the population without crashing the worker or evolution loop,
  enabling robust long-running training.
- ✅ **Forward-Only Topology Enforcement** _(NEAT-AI extension)_: Unconditional
  topology validation after creature initialisation, with DEBUG-gated assertions
  after bulk neuron remapping operations, ensuring backward synapses cannot
  silently corrupt forward-only creatures.
- ✅ **Numerical Stability** _(NEAT-AI extension)_: Unbounded activation
  functions (TAN, SQUARE, CUBE) are clamped to finite ranges in both TypeScript
  and Rust WASM implementations, preventing numerical overflow from producing
  extreme scores.
- ✅ **Per-Species Breeding Quotas** _(NEAT-AI extension)_: On top of standard
  NEAT fitness sharing, per-species breeding quotas guarantee each surviving
  species a minimum number of breeding slots (`FitnessSharingConfig`, enabled by
  default).
- ✅ **Stagnant Species Detection and Retirement** _(NEAT-AI extension)_:
  Species that fail to improve their best raw fitness across a sliding window
  are first halted (50% breeding reduction) and then made extinct, reclaiming
  breeding slots for progressing species. Configurable via
  `SpeciesStagnationConfig` (`haltWindow`, `extinctionWindow`).
- ✅ **Soft Compatibility-Gated Cross-Species Breeding** _(NEAT-AI extension)_:
  Replaces hard lowest-compatibility father selection with a soft probabilistic
  gate that accepts candidates with probability `compatibility ^ power`,
  preserving rare exploratory hybrids while favouring similar architectures
  (`CompatibilityGatingConfig`, enabled by default).
- ✅ **Fitness-Driven Squash Mutation** _(NEAT-AI extension)_: Squash function
  selection during mutation is biased toward activations that historically
  improved fitness in similar neuron roles (layer depth + fan-in bucket). Uses
  EMA-smoothed fitness deltas with Boltzmann-weighted selection
  (`SquashEffectivenessConfig`, enabled by default).
- ✅ **DNA-Sharing Primitives** _(NEAT-AI extension)_: A bake-off harness
  compares strategies for transferring useful structure between unrelated
  creatures. The current recommended primitive is `PruningTemplateStrategy`,
  which uses an oracle creature ("Europa") to identify and remove redundant
  production neurons via activation-fingerprint correlation. Additional
  primitives include `KnowledgeDistillation` and `CompactModuleGraft`. See
  [dna-sharing-bake-off-results.md](../dna-sharing-bake-off-results.md).
- ✅ **Optional Rust CLI Scorer with WASM Fallback** _(NEAT-AI extension)_:
  Generation scoring can be delegated to an external `rust_scorer` binary for
  higher throughput (directory/batch mode runs once per generation), with
  automatic fallback to the in-process WASM scorer when the binary is
  unavailable or errors out (`RustScorerConfig`, opt-in).
- ✅ **NEAT-AI-core Pinning and Parity Gate** _(NEAT-AI extension)_: Read-heavy
  and hot-path computations (topology validation/scanning, reverse topological
  order, cycle detection, the topological backprop loop, and elastic weight
  distribution) are owned by the external
  [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository,
  pinned by full 40-character SHA in `deno.json`. A parity gate prevents drift
  between the in-tree wrappers and the pinned core. There are no TypeScript
  fallbacks for core-owned operations — failure to load the WASM bundle is
  fail-fast with an actionable error.

## 🔗 Related comparison pages

- [Architectural comparison](./ARCHITECTURES.md) — NEAT-AI vs feedforward, CNN,
  RNN, and Transformer topologies.
- [Unique approaches](./UNIQUE_APPROACHES.md) — deep dives on the headline
  NEAT-AI extensions.
- [References](./REFERENCES.md) — supporting literature for every claim above.
