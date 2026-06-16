# ✨ NEAT-AI's Unique Approaches

Part of the [Comparison hub](../../COMPARISON.md). These are the headline
**[NEAT-AI](../../AGENTS.md#-terminology)** extensions — each one is absent from
standard [NEAT](../../AGENTS.md#-terminology) and, in most cases, uncommon in
other open-source neuroevolution libraries.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** Every approach below is a NEAT-AI extension. Where it
> contrasts with the 2002 algorithm, that contrast is stated explicitly, per the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use).

## 1. 🧬 Memetic Evolution (Hybrid Evolution + Backpropagation)

**What it is**: A hybrid approach that records successful weight patterns from
the fittest creatures and reuses them in future generations.

**How it works**:

1. When a creature is mutated, we preserve its original state.
2. After mutation, we compare the new creature to its parent.
3. If the topology is unchanged, we record the weight/bias differences as
   "memetic" information.
4. Future creatures with similar topologies can inherit these successful
   patterns.

**Why it helps**: In our own workloads, memetic evolution has often converged
faster than pure backpropagation because it preserves successful weight patterns
across generations, combines the exploration of evolution with the exploitation
of gradient descent, and bridges the gap between evolutionary and gradient-based
learning. **Standard NEAT has no memetic step.**

**Reference**: See Feature #9 in [README.md](../../README.md) and
[Memetic Algorithms](https://en.wikipedia.org/wiki/Memetic_algorithm).

## 2. ⚡ Error-Guided Structural Evolution

**What it is**: GPU-accelerated discovery that analyses neuron activations and
errors to suggest beneficial structural changes.

**How it works**:

1. During training, we record neuron activations and errors.
2. The Rust discovery engine (GPU-accelerated) analyses this data.
3. It identifies helpful synapses to add, harmful synapses to remove, new
   neurons that could reduce error, and better activation functions.
4. These suggestions become candidate creatures for evolution.

**Why it's unique**: **Unlike standard NEAT, which uses random structural
mutations**, NEAT-AI uses error-driven hints to guide evolution, prioritising
candidates suggested by measured error patterns. To our knowledge this
combination of NEAT-style evolution with a separate, GPU-accelerated Rust
discovery engine and a cost-of-growth gate is uncommon in open-source NEAT
implementations.

**Real-world impact**: In our deployments this discovery step typically finds
small improvements (around 0.5–3% per discovery run) that add up over many
iterations, letting long-lived creatures keep improving structurally without
manual architecture tweaking.

**Reference**: See Feature #10 in [README.md](../../README.md) and
[GPU_ACCELERATION.md](../GPU_ACCELERATION.md).

## 3. 🔑 UUID-Based Extensible Observations

**What it is**: Neurons are identified by UUIDs rather than numeric indices,
allowing dynamic addition of input/output features.

**How it works**: Each neuron has a unique UUID; synapses reference neurons by
UUID, not index; new input neurons can be added without breaking existing
connections; and evolution continues seamlessly when new features are
introduced.

**Why it's unique**: **Standard NEAT identifies genes by integer innovation
numbers and traditional networks require fixed input/output dimensions.**
NEAT-AI's UUID scheme allows incremental feature engineering without restarting
training.

**Real-world impact**: UUID-based indexing dramatically improved genetic
compatibility between creatures evolved on different machines (islands),
enabling successful cross-island breeding that would have failed with numeric
indexing.

**Reference**: See Feature #1 in [README.md](../../README.md).

## 4. 🌐 Distributed Evolution with Centralised Combination

**What it is**: Evolution can run on multiple independent nodes, with
best-of-breed creatures combined on a central controller.

> [!TIP]
> UUID-based indexing makes distributed combination possible: creatures evolved
> on different machines share a common neuron-identity scheme, so cross-island
> breeding works without index remapping.

**How it works**: Each node runs independent evolution; the best creatures from
each node are periodically sent to a controller; the controller combines
populations and redistributes them — enabling scaling beyond single-machine
constraints.

**Why it's unique**: **Standard NEAT and most NEAT-derived implementations are
single-machine.** NEAT-AI's distributed approach enables larger populations and
faster evolution.

**Reference**: See Feature #2 in [README.md](../../README.md).

## 5. 💉 CRISPR Gene Injection

**What it is**: Targeted gene insertion during evolution to introduce specific
traits.

**How it works**: Pre-defined gene patterns (connections, neurons, activation
functions) are injected during breeding or mutation phases, allowing domain
knowledge to guide evolution.

**Why it's unique**: Provides a way to incorporate expert knowledge into the
evolutionary process — **standard NEAT has no equivalent.**

**Reference**: See Feature #7 in [README.md](../../README.md).

## 6. 🌿 Grafting for Incompatible Parents

**What it is**: When parents aren't genetically compatible, NEAT-AI uses a
grafting algorithm instead of standard crossover.

**How it works**: Genetic compatibility is measured by topology similarity; if
parents are too different, standard crossover fails; the grafting algorithm
transfers compatible sub-networks from one parent to another, enabling
cross-species breeding.

**Why it's unique**: **Standard NEAT does not breed across speciation
boundaries.** Grafting lets evolution combine solutions from different "islands"
of the search space.

**Reference**: See Feature #8 in [README.md](../../README.md).

## 7. 🧠 Predictive Coding Training

**What it is**: An optional training paradigm based on predictive coding theory
([Rao & Ballard, 1999](https://www.nature.com/articles/nn0199_79)) that
minimises prediction error through iterative inference settling and local
Hebbian learning rules.

**How it works**:

1. Input and target values are clamped to the network.
2. An iterative settling loop adjusts latent values to minimise prediction error
   energy (E = ½ Σ ε²).
3. Once settled, local Hebbian weight updates are computed: ΔW = η · f'(a) · ε ·
   x.
4. Updates are applied with symmetric (shared) weights rather than separate
   prediction weights.

**Why it's unique**: Predictive coding uses only local information for learning,
which aligns naturally with NEAT-AI's neuron-centric topology and provides an
alternative to standard backpropagation. **Standard NEAT has no equivalent.**

**Configuration**: Controlled via `PredictiveCodingConfig`; disabled by default.

**Reference**: See [PREDICTIVE_CODING.md](../PREDICTIVE_CODING.md).

## 8. 🔍 Discovery Caching and Disk Space Management

**What it is**: A suite of enhancements to the discovery pipeline that cache
evaluation results, inform future candidate building from historical data, and
monitor disk space to prevent failures.

**How it works**: a **success cache** persists discovery candidates that
improved a creature's score; a **failure cache** prevents redundant
re-evaluation with weight-magnitude bucketing; **age- and size-based eviction**
prevents unbounded growth; **cache-informed candidates** supplement candidate
building; and **disk-space monitoring** with configurable thresholds prevents
opaque I/O failures.

**Why it's unique**: Most neuroevolution implementations treat each structural
search independently. NEAT-AI's caching layer lets the discovery pipeline learn
from its own history.

## 9. 🎲 MCMC Mutation Acceptance

**What it is**: A
[Metropolis-Hastings](https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm)
acceptance criterion applied to creature mutations, replacing unconditional
acceptance.

**How it works**:

1. After a mutation, the new creature's fitness is compared to its parent.
2. Improving mutations are always accepted.
3. Worsening mutations are accepted with probability
   `exp(−Δfitness / temperature)`, with temperature following an exponential
   cooling schedule.
4. Adaptive temperature tuning targets the theoretically optimal acceptance rate
   (~23.4%, Roberts et al. 1997).

**Why it's unique**: **Standard NEAT accepts all mutations unconditionally; most
NEAT derivatives use simple fitness-based filtering.** NEAT-AI's MCMC acceptance
lets the population explore broadly early (high temperature) and converge later
(low temperature).

**Diversity-aware cooling**: When species count drops below `minSpecies` or mean
within-species compatibility exceeds `crowdingThreshold`, the temperature is
multiplied by `reheatFactor` to restore exploration, preventing premature
convergence in long-running deployments.

**Configuration**: Opt-in via `mcmc: { enabled: true }`; diversity-aware cooling
via the nested `diversityAwareMCMC` block.

**Reference**: See Feature #20 in [README.md](../../README.md).

## 10. 🧬 Advanced Breeding Strategies

**What it is**: Multiple breeding strategies for genetically incompatible
creatures that go beyond standard NEAT crossover.

**How it works**:

- **Input-weight crossover**: blends input/output connection weights from both
  parents while preserving the mother's topology.
- **Cosine-similarity alignment**: matches neurons by functional role rather
  than array position.
- **Subgraph transplantation**: transplants self-contained 2–5 neuron clusters
  (with new UUIDs), inspired by
  [horizontal gene transfer](https://en.wikipedia.org/wiki/Horizontal_gene_transfer).
- **Diversity-driven breeding**: breeds the fittest with genetically distant
  newcomers to inject diversity.
- **Soft compatibility gating**: accepts father candidates with probability
  `compatibility ^ power`.
- **Fitness sharing + per-species breeding quotas**: prevents dominant species
  from starving smaller niches.
- **Stagnant-species retirement**: halts and ultimately retires non-improving
  species, reclaiming breeding budget.

**Why it's unique**: **Standard NEAT and most derivatives fall back to simple
fitness-based selection when parents are incompatible.** NEAT-AI preserves
meaningful genetic information across species boundaries.

**Reference**: See Feature #21 in [README.md](../../README.md).

## 11. 🧮 Muon-Style Orthogonalised Gradient Updates

**What it is**: An optional gradient orthogonalisation step that runs a
Newton-Schulz polynomial iteration on per-neuron incoming-weight gradient
matrices before applying them, decorrelating update directions. Inspired by the
Muon optimiser used in DeepSeek V4.

**How it works**:

1. Accumulated weight gradients per neuron are reshaped into a small matrix.
2. A few Newton-Schulz iterations approximate the orthogonal polar factor.
3. The orthogonalised update is scaled and applied in place of the raw gradient.

**Why it's unique**: **Standard NEAT has no gradient step at all.** NEAT-AI's
default backpropagation applies raw gradient descent; Muon-style updates remove
correlations between row directions of the per-neuron gradient, producing
smoother training, particularly for the small batch sizes typical in
evolutionary fitness evaluation.

**Configuration**: Opt-in via `gradientOrthogonalisation: "muon"` in
`BackPropagationArguments` (default `"none"`).

**Reference**: See
[`src/propagate/MuonOrthogonalisation.ts`](../../src/propagate/MuonOrthogonalisation.ts).

## 12. 🔗 Synthetic Synapse Training

**What it is**: Temporary dense inter-layer connectivity during backpropagation
that addresses the inherent sparse connectivity of NEAT-evolved networks.

**How it works**:

1. Before backpropagation, zero-weight synapses are added between all neuron
   pairs in adjacent topological layers (by layer assignment).
2. Backpropagation runs with this densified connectivity, giving gradient
   descent a richer search space.
3. After training, near-zero synapses are pruned; only connections that
   developed meaningful weights are retained.

**Why it's unique**: **Standard NEAT (and NEAT-AI before this step) produces
naturally sparse networks** — they start minimal and grow only through mutation.
Synthetic synapses provide a temporary
[layer densification](https://en.wikipedia.org/wiki/Dense_layer) step that lets
gradient descent discover useful connections without permanently inflating the
network.

**Configuration**: Opt-in via `syntheticSynapses: true`.

**Reference**: See Feature #22 in [README.md](../../README.md).

## 🔗 Related comparison pages

- [What NEAT-AI implements](./IMPLEMENTED.md) — the full feature breakdown.
- [Ecosystem comparison](./ECOSYSTEM.md) — NEAT-AI vs TensorFlow/PyTorch.
- [References](./REFERENCES.md) — supporting literature.
