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

## 📐 Reading the `Prior art:` lines

Framing every extension against the 2002 paper alone says how far it is from
standard NEAT, but not how much evidence stands behind it. Each extension below
therefore carries a **`Prior art:`** line with one of three tags, so a
well-supported borrowing is not presented like an open bet:

- **📚 borrowed** — an established result NEAT-AI implements. The citation is
  where it comes from; the risk is in the adaptation, not the idea.
- **🎲 open bet** — no established result at this scale. The citation, where
  there is one, is the closest precedent, and NEAT-AI is betting past it.
- **🔧 engineering** — infrastructure with no literature ancestor to name
  (caching to disk, panic recovery, format export).

Citations link into [REFERENCES.md](./REFERENCES.md), which leads every section
with the primary source.

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
  - **Prior art (📚 borrowed):**
    [Rumelhart, Hinton & Williams (1986)](./REFERENCES.md#-traditional-neural-networks)
    — gradient training itself, applied here to an evolved topology rather than
    a fixed one.
- ✅ **Memetic Evolution** _(NEAT-AI extension)_: Records successful weight
  patterns and reuses them in later generations, following the
  [memetic algorithm](https://en.wikipedia.org/wiki/Memetic_algorithm) approach.
  Standard NEAT has no memetic step; in NEAT-AI's internal benchmarks this
  hybrid step improves convergence over evolution alone.
  - **Prior art (📚 borrowed):**
    [Moscato (1989)](./REFERENCES.md#-memetic-algorithms) named the family.
    Writing trained weights back into the genome is the Lamarckian variant,
    which
    [Whitley, Gordon & Mathias (1994)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution)
    measured as faster convergence at the cost of population diversity.
- ✅ **Error-Guided Structural Evolution** _(NEAT-AI extension)_:
  GPU-accelerated discovery of beneficial structural changes. Standard NEAT
  performs structural mutation uniformly at random; NEAT-AI guides it with
  measured error data — see [DISCOVERY_GUIDE.md](../DISCOVERY_GUIDE.md).
  - **Prior art (📚 borrowed):**
    [Fahlman & Lebiere (1990)](./REFERENCES.md#-structural-growth),
    Cascade-Correlation — new units chosen against the residual error. The
    propose-cheaply / confirm-expensively pipeline around it is
    [Jin (2011)](./REFERENCES.md#-surrogate-assisted-search-and-racing).
- ✅ **Sparse Training** _(NEAT-AI extension)_: Configurable neuron selection
  strategies (random, output-distance, error-weighted) for efficiency.
  - **Prior art (📚 borrowed):** the dynamic-sparsity family —
    [Mocanu et al. (2018), SET and Evci et al. (2020), RigL](./REFERENCES.md#-pruning-and-sparsity).
    NEAT-AI borrows the idea of training a subset per step, choosing which
    _neurons_ to update rather than which weights to keep.
- ✅ **Batch Processing** _(NEAT-AI extension)_: Mini-batch gradient descent
  with configurable batch sizes.
  - **Prior art (📚 borrowed):** textbook mini-batch stochastic gradient descent
    — see the [optimiser survey](./REFERENCES.md#-traditional-neural-networks).
- ✅ **Early Stopping** _(NEAT-AI extension)_: Enhanced early stopping with
  patience and improvement thresholds.
  - **Prior art (📚 borrowed):** textbook early stopping. The caveat that
    matters here is [Dwork et al. (2015)](./REFERENCES.md#-evaluation-validity):
    the same held-out data is reused for thousands of stop/continue decisions,
    which erodes its validity.
- ✅ **Predictive Coding** _(NEAT-AI extension)_: Optional training paradigm
  based on [Rao & Ballard (1999)](https://www.nature.com/articles/nn0199_79)
  that uses iterative inference settling and local Hebbian learning rules.
  Configurable via `PredictiveCodingConfig` with inference steps, learning rate,
  and energy convergence thresholds. See
  [PREDICTIVE_CODING.md](../PREDICTIVE_CODING.md) for architecture details and
  the contrast with standard NEAT (which has no equivalent).
  - **Prior art (📚 borrowed):** Rao & Ballard (1999), linked above — the
    neuroscience model this implements directly.
- ✅ **Dropout Regularisation** _(NEAT-AI extension)_: True
  [inverted dropout](https://arxiv.org/abs/1207.0580) during training — randomly
  disables a configurable fraction of hidden neurons per forward pass and scales
  remaining activations by 1/(1−p) so inference runs unchanged. Input and output
  neurons are never dropped.
  - **Prior art (📚 borrowed):** Hinton et al. (2012), linked above.
- ✅ **L1/L2 Weight & Bias Regularisation** _(NEAT-AI extension)_: During
  backpropagation, applies L2 weight decay (`w *= (1 − lr·λ₂)`) and L1
  soft-thresholding to drive small weights to exactly zero, promoting sparsity.
  Mirrors the same decay for biases. Standard NEAT has no gradient step at all
  and therefore no weight decay.
  - **Prior art (📚 borrowed):** standard weight decay and L1 sparsity; the
    formal justification for paying for structure is minimum description length,
    [Rissanen (1978) and Hinton & van Camp (1993)](./REFERENCES.md#-pruning-and-sparsity).
- ✅ **Gradient Accumulation Normalisation** _(NEAT-AI extension)_: Optional
  sqrt-scaling for gradient accumulation in high fan-out neurons, preventing
  neurons with many downstream connections from receiving disproportionately
  large error signals.
  - **Prior art (🔧 engineering):** a fan-out scaling fix for irregular evolved
    topologies. No literature ancestor to name — fixed-architecture training
    rarely sees the fan-out spread this corrects.
- ✅ **Synthetic Synapse Training** _(NEAT-AI extension)_: Temporarily densifies
  inter-layer connectivity during backpropagation by adding zero-weight synapses
  between adjacent topological layers. After training, near-zero synapses are
  pruned and only useful connections are retained — addressing the inherent
  sparseness of NEAT-evolved networks compared to conventional
  [dense layers](https://en.wikipedia.org/wiki/Dense_layer). Opt-in via
  `syntheticSynapses: true` in the training configuration.
  - **Prior art (📚 borrowed):**
    [Han et al. (2017), DSD](./REFERENCES.md#-pruning-and-sparsity) — the
    densify / train / prune cycle — with SET and RigL as the dynamic-sparsity
    successors.
- ✅ **MCMC Mutation Acceptance** _(NEAT-AI extension)_: Uses the
  [Metropolis-Hastings](https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm)
  criterion for mutation acceptance. Standard NEAT accepts all mutations
  unconditionally; NEAT-AI accepts worsening mutations only with a
  temperature-dependent probability so the population can escape local optima
  early and converge later. Includes adaptive temperature tuning toward the
  ~23.4% acceptance rate. The cooling schedule is also coupled to a live
  diversity signal: when species count collapses or within-species crowding
  rises, the temperature is reheated to restore exploration
  (`diversityAwareMCMC` block). Opt-in via `mcmc: { enabled: true }`.
  - **Prior art (📚 borrowed):**
    [Metropolis et al. (1953) for the rule, and Kirkpatrick, Gelatt & Vecchi (1983) for its use in a search algorithm](./REFERENCES.md#-markov-chain-monte-carlo-mcmc).
    The ~23.4% target is a heuristic borrowed from Roberts et al. (1997), whose
    optimal-scaling result is about random-walk Metropolis on smooth
    high-dimensional targets, not about evolutionary-algorithm acceptance rates.
    Reheating on a diversity signal has no such precedent.
- ✅ **Muon-Style Orthogonalised Gradient Updates** _(NEAT-AI extension)_:
  Optional Newton-Schulz polynomial iteration applied to per-neuron gradient
  matrices during backpropagation, decorrelating update directions for improved
  training stability. Inspired by the DeepSeek V4 approach. Opt-in via
  `gradientOrthogonalisation: "muon"` in `BackPropagationArguments` (default
  `"none"`).
  - **Prior art (🎲 open bet):** orthogonalised updates are established for
    large dense weight matrices. Applying them per neuron, on the small
    irregular gradient matrices of an evolved sparse topology, is untested
    outside this repository.

## ✨ NEAT-AI extensions — architecture, identity, and tooling

- ✅ **UUID-Based Indexing** _(NEAT-AI extension)_: Extensible observations
  without restarting evolution — new input features can be added dynamically by
  extending the historical-marking idea from
  [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)
  to UUID-keyed neuron identity. Standard NEAT identifies genes by integer
  innovation numbers only. (NEAT-AI keeps a stable persisted UUID per neuron for
  identity and a runtime integer `id` for hot-loop speed — see
  [`src/architecture/NeuronId.ts`](../../src/architecture/NeuronId.ts).)
  - **Prior art (📚 borrowed):** historical marking from
    [Stanley & Miikkulainen (2002)](./REFERENCES.md#-neat-algorithm-standard-neat),
    with the innovation number replaced by a UUID so markings stay unique across
    machines that never share a counter.
- ✅ **Distributed Evolution** _(NEAT-AI extension)_: Multi-node training with
  centralised combination of best-of-breed creatures, similar to the
  [island model](https://en.wikipedia.org/wiki/Island_model). Standard NEAT is
  single-machine.
  - **Prior art (📚 borrowed):**
    [Cohoon et al. (1987) and Tanese (1989)](./REFERENCES.md#-horizontal-gene-transfer-and-breeding)
    — the island model's primary sources: isolated subpopulations with periodic
    migration.
- ✅ **Lifelong Learning** _(NEAT-AI extension)_: Continuous adaptation via
  ongoing evolution and backpropagation. In long-running deployments (for
  example, generating fresh training data each day from many years of financial,
  market, or company reporting data), the same population can keep training and
  adapting as new samples and new features arrive. This supports
  [continual learning](https://en.wikipedia.org/wiki/Continual_learning) while
  still relying on your training data mix to keep past behaviour represented.
  - **Prior art (📚 borrowed):** the continual-learning literature, for which
    REFERENCES.md carries no primary source yet — the orientation link above is
    the entry point until it does.
- ✅ **CRISPR Gene Injection** _(NEAT-AI extension)_: Targeted gene insertion
  during evolution to introduce specific traits, inspired by
  [CRISPR-Cas9 gene editing](https://www.nature.com/scitable/topicpage/crispr-cas9-a-precise-tool-for-33169884/).
  - **Prior art (📚 borrowed):** population seeding / domain-knowledge
    injection, long-standing evolutionary-algorithm practice. The house name is
    a biology metaphor, not a claim of novelty.
- ✅ **Grafting** _(NEAT-AI extension)_: Cross-species breeding algorithm for
  genetically incompatible parents that preserves diversity like cross-island
  migration in the [island model](https://en.wikipedia.org/wiki/Island_model).
  Standard NEAT does not breed across speciation boundaries.
  - **Prior art (🎲 open bet):** the closest precedent is
    [Barr et al. (2015), _Automated Software Transplantation_](./REFERENCES.md#-horizontal-gene-transfer-and-breeding),
    which also had to carry a transplant's dependencies across. The bet is
    against the competing-conventions problem: two genomes can encode the same
    function under different neuron orderings, so recombining them may destroy
    both.
- ✅ **Neuron Pruning** _(NEAT-AI extension)_: Automatic removal of neurons
  whose activations don't vary during training, echoing established
  [network pruning](https://en.wikipedia.org/wiki/Pruning_(neural_networks))
  practice.
  - **Prior art (📚 borrowed):**
    [LeCun, Denker & Solla (1989), _Optimal Brain Damage_, and Hassibi & Stork (1993)](./REFERENCES.md#-pruning-and-sparsity).
    NEAT-AI's activation-variance criterion is a zeroth-order member of that
    family — cheaper than second-order saliency, and correspondingly blunter.
- ✅ **GPU-Accelerated Discovery** _(NEAT-AI extension)_: Cross-platform GPU
  support via [wgpu](https://wgpu.rs/) abstraction — Metal on macOS, Vulkan on
  Linux, DX12 on Windows. Analysis is GPU-only: with no compatible adapter the
  pass is refused and discovery yields no proposals.
  - **Prior art (🔧 engineering):** vendor GPU tooling — see the
    [GPU acceleration links](./REFERENCES.md#-gpu-acceleration).
- ✅ **Discovery Caching** _(NEAT-AI extension)_: Success and failure caching
  for discovery candidates with age-based and size-based eviction,
  cache-informed multi-neuron removal candidates, and supplemental candidate
  building from historical data.
  - **Prior art (📚 borrowed):**
    [Glover (1986), tabu search](./REFERENCES.md#-surrogate-assisted-search-and-racing)
    — memory-based search that refuses to re-propose what has already been
    tried.
- ✅ **Disk Space Monitoring** _(NEAT-AI extension)_: Pre-flight and runtime
  disk space checks during discovery to gracefully warn or abort when disk space
  is insufficient.
  - **Prior art (🔧 engineering):** operational safety for long runs; no
    literature ancestor.
- ✅ **Adaptive Quantum Steps** _(NEAT-AI extension)_: `QuantumStepConfig`
  provides adaptive step sizing during memetic fine-tuning — larger steps when
  far from the optimum and smaller steps during convergence.
  - **Prior art (📚 borrowed):** adaptive step-size control, standard in local
    search; the memetic analogue is
    [Ong & Keane (2004)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution),
    which adapts _which_ local search runs rather than how far it steps.
- ✅ **Unique Activation Functions** _(NEAT-AI extension)_: IF, MAX, MIN, and
  other non-standard squashes that enable different network behaviours, akin to
  the broader family of
  [activation functions](https://en.wikipedia.org/wiki/Activation_function).
  Standard NEAT typically restricts itself to sigmoid.
  - **Prior art (🎲 open bet):** the activation-function literature covers
    smooth scalar squashes. A conditional squash whose inward synapses carry
    roles (`condition`, `positive`, `negative`) is a different object, and its
    effect on evolvability is measured only here.
- ✅ **Improved Aggregate Gradient Flow** _(NEAT-AI extension)_: MAXIMUM and
  MINIMUM aggregate functions distribute partial error signals to runner-up
  connections within a proximity window of 20% of the winning magnitude (leaking
  up to 15% of the error), preventing dead gradient paths while preserving
  dominance of the winning connection.
  - **Prior art (🎲 open bet):** routing gradient only to the winner is standard
    max-pooling practice; deliberately leaking a bounded share to near-winners
    is NEAT-AI's, and the window and leak fractions are tuned rather than
    derived.
- ✅ **Transfer Learning** _(NEAT-AI extension)_: Checkpoint export/import
  system with UUID-based neuron and synapse mapping between creatures with
  different input/output configurations. Supports weight freezing for
  fine-tuning imported hidden layers and population seeding with pre-trained
  creatures. Standard NEAT has no transfer-learning concept.
  - **Prior art (📚 borrowed):** ordinary transfer learning — freeze, remap,
    fine-tune. The UUID-keyed remapping across differing input/output sets is
    the NEAT-AI-specific part.
- ✅ **ONNX Format Export** _(NEAT-AI extension)_: Exports trained creatures to
  the [ONNX](https://onnx.ai/) binary format for interoperability with standard
  ML tooling. Converts creature topology to ONNX computational graphs with
  compatibility checking for unsupported features (aggregate functions,
  recurrent connections).
  - **Prior art (🔧 engineering):** format interoperability against the ONNX
    specification; no literature ancestor.
- ✅ **Adaptive Population Sizing** _(NEAT-AI extension)_: Automatically adjusts
  population size based on species diversity metrics — growing the population
  when diversity is low (premature convergence) and shrinking it during
  high-diversity stagnation.
  - **Prior art (🎲 open bet):** the established answer to a population
    collapsing onto one peak is fitness sharing,
    [Goldberg & Richardson (1987)](./REFERENCES.md#-linkage-and-epistasis).
    Resizing the population itself on a diversity signal is the bet, and the
    growth and shrink thresholds are tuned here rather than taken from a result.
- ✅ **Parallel Batch Creature Evaluation** _(NEAT-AI extension)_:
  Topology-aware grouping clusters same-structure creatures in the evaluation
  queue to maximise WASM compilation cache hits across workers, with
  configurable concurrency limits.
  - **Prior art (🔧 engineering):** scheduling for compilation-cache locality;
    no literature ancestor.
- ✅ **Advanced Breeding Strategies** _(NEAT-AI extension)_: Multiple breeding
  strategies for genetically incompatible creatures, including input-weight
  cosine similarity for neuron alignment, subgraph transplantation for
  [horizontal gene transfer](https://en.wikipedia.org/wiki/Horizontal_gene_transfer),
  and diversity-driven breeding for cross-population pairing. Standard NEAT
  refuses crossover between incompatible parents.
  - **Prior art (🎲 open bet):** cosine-similarity alignment is borrowed
    ([cosine similarity](./REFERENCES.md#-horizontal-gene-transfer-and-breeding)),
    but subgraph transplantation between incompatible genomes rests on the same
    single precedent as grafting, Barr et al. (2015), and carries the same
    competing-conventions risk.
- ✅ **WASM Panic Recovery** _(NEAT-AI extension)_: Graceful handling of WASM
  unreachable panics during evolution. Creatures that trigger WASM traps are
  excluded from the population without crashing the worker or evolution loop,
  enabling robust long-running training.
  - **Prior art (🔧 engineering):** fault isolation at a runtime boundary; no
    literature ancestor.
- ✅ **Forward-Only Topology Enforcement** _(NEAT-AI extension)_: Unconditional
  topology validation after creature initialisation, with DEBUG-gated assertions
  after bulk neuron remapping operations, ensuring backward synapses cannot
  silently corrupt forward-only creatures.
  - **Prior art (🔧 engineering):** an invariant check on the data structure; no
    literature ancestor.
- ✅ **Numerical Stability** _(NEAT-AI extension)_: Unbounded activation
  functions (TAN, SQUARE, CUBE) are clamped to finite ranges in both TypeScript
  and Rust WASM implementations, preventing numerical overflow from producing
  extreme scores.
  - **Prior art (🔧 engineering):** floating-point range control; no literature
    ancestor.
- ✅ **Per-Species Breeding Quotas** _(NEAT-AI extension)_: On top of standard
  NEAT fitness sharing, per-species breeding quotas guarantee each surviving
  species a minimum number of breeding slots (`FitnessSharingConfig`, enabled by
  default).
  - **Prior art (📚 borrowed):**
    [Goldberg & Richardson (1987)](./REFERENCES.md#-linkage-and-epistasis),
    fitness sharing — the classical answer to a population collapsing onto one
    peak. The guaranteed floor is a stricter form of the same idea.
- ✅ **Stagnant Species Detection and Retirement** _(NEAT-AI extension)_:
  Species that fail to improve their best raw fitness across a sliding window
  are first halted (50% breeding reduction) and then made extinct, reclaiming
  breeding slots for progressing species. Configurable via
  `SpeciesStagnationConfig` (`haltWindow`, `extinctionWindow`).
  - **Prior art (📚 borrowed):** stagnation-based species extinction is in
    [the 2002 NEAT paper](./REFERENCES.md#-neat-algorithm-standard-neat) itself;
    halting before extinguishing follows the racing idea of
    [Maron & Moore (1994)](./REFERENCES.md#-surrogate-assisted-search-and-racing)
    — cut a candidate's budget as the evidence against it accumulates.
- ✅ **Soft Compatibility-Gated Cross-Species Breeding** _(NEAT-AI extension)_:
  Replaces hard lowest-compatibility father selection with a soft probabilistic
  gate that accepts candidates with probability `compatibility ^ power`,
  preserving rare exploratory hybrids while favouring similar architectures
  (`CompatibilityGatingConfig`, enabled by default).
  - **Prior art (🎲 open bet):** standard NEAT gates crossover on a hard
    compatibility threshold. Softening that threshold into an acceptance
    probability is NEAT-AI's, and `power` is tuned, not derived.
- ✅ **Fitness-Driven Squash Mutation** _(NEAT-AI extension)_: Squash function
  selection during mutation is biased toward activations that historically
  improved fitness in similar neuron roles (layer depth + fan-in bucket). Uses
  EMA-smoothed fitness deltas with Boltzmann-weighted selection
  (`SquashEffectivenessConfig`, enabled by default).
  - **Prior art (📚 borrowed):** adaptive operator selection — give credit to
    the operators that have been paying, then sample in proportion. The memetic
    form of the same idea is
    [Ong & Keane (2004)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution).
- ✅ **DNA-Sharing Primitives** _(NEAT-AI extension)_: A bake-off harness
  compares strategies for transferring useful structure between unrelated
  creatures. The current recommended primitive is `PruningTemplateStrategy`,
  which uses an oracle creature ("Europa") to identify and remove redundant
  production neurons via activation-fingerprint correlation. Additional
  primitives include `KnowledgeDistillation` and `CompactModuleGraft`. See
  [dna-sharing-bake-off-results.md](../dna-sharing-bake-off-results.md).
  - **Prior art (🎲 open bet):** knowledge distillation and module grafting are
    established individually; using one creature as an oracle to prune another
    by activation-fingerprint correlation is measured only by this repository's
    own bake-off. Read the results, not the premise.
- ✅ **Optional Rust CLI Scorer with WASM Fallback** _(NEAT-AI extension)_:
  Generation scoring can be delegated to an external `rust_scorer` binary for
  higher throughput (directory/batch mode runs once per generation), with
  automatic fallback to the in-process WASM scorer when the binary is
  unavailable or errors out (`RustScorerConfig`, opt-in).
  - **Prior art (🔧 engineering):** process-level work offload; no literature
    ancestor.
- ✅ **NEAT-AI-core Pinning and Parity Gate** _(NEAT-AI extension)_: Read-heavy
  and hot-path computations (topology validation/scanning, reverse topological
  order, cycle detection, the topological backprop loop, and elastic weight
  distribution) are owned by the external
  [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository,
  pinned by full 40-character SHA in `deno.json`. A parity gate prevents drift
  between the in-tree wrappers and the pinned core. There are no TypeScript
  fallbacks for core-owned operations — failure to load the WASM bundle is
  fail-fast with an actionable error.
  - **Prior art (🔧 engineering):** dependency pinning and cross-implementation
    conformance testing; no literature ancestor.

## 🔗 Related comparison pages

- [Architectural comparison](./ARCHITECTURES.md) — NEAT-AI vs feedforward, CNN,
  RNN, and Transformer topologies.
- [Unique approaches](./UNIQUE_APPROACHES.md) — deep dives on the headline
  NEAT-AI extensions.
- [References](./REFERENCES.md) — supporting literature for every claim above.
