# ✨ NEAT-AI's Unique Approaches

Part of the [Comparison hub](../../COMPARISON.md). These are the headline
**[NEAT-AI](../../AGENTS.md#-terminology)** extensions — each one is absent from
standard [NEAT](../../AGENTS.md#-terminology) and, in most cases, uncommon in
other open-source neuroevolution libraries.

**Absent from NEAT is not the same as new.** Standard NEAT (2002) is the only
baseline these sections compare against, and most of what follows has a named
precedent in the wider literature — often decades old. Every section therefore
carries a **Prior art** callout naming what the technique is called outside this
project, with the citation in [REFERENCES.md](./REFERENCES.md). The house names
stay; the implied novelty does not.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

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

> **Prior art:** evolution plus per-individual local search is a memetic
> algorithm, named by [Moscato (1989)](./REFERENCES.md#-memetic-algorithms).
> Writing the trained weights back into the genome is the Lamarckian choice:
> [Hinton & Nowlan (1987)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution)
> showed learning can guide evolution with no write-back at all, and
> [Whitley, Gordon & Mathias (1994)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution)
> measured the trade NEAT-AI is making — faster convergence, less population
> diversity. Choosing _which_ local search to apply, adaptively, is
> meta-Lamarckian learning
> ([Ong & Keane, 2004](./REFERENCES.md#-lamarckian-and-baldwinian-evolution)).

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

> **Prior art:** choosing new structure by how well it explains the residual
> error is Cascade-Correlation,
> [Fahlman & Lebiere (1990)](./REFERENCES.md#-structural-growth) — Discovery's
> direct ancestor. The modern line is
> [Net2Net (Chen, Goodfellow & Shlens, 2016)](./REFERENCES.md#-structural-growth),
> [Firefly neuron splitting (Wu et al., 2020)](./REFERENCES.md#-structural-growth)
> and [GradMax (Evci et al., 2022)](./REFERENCES.md#-structural-growth). What is
> ours is the packaging, not the idea: an out-of-process GPU proposer feeding
> candidates into a NEAT-style population behind a cost-of-growth gate.

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

> **Prior art:** none needed — this is the same semantics as the innovation
> number of
> [Stanley & Miikkulainen (2002)](./REFERENCES.md#-neat-algorithm-standard-neat),
> decentralised. A historical marking still labels a gene so parents can be
> aligned by ancestry rather than position; replacing the shared counter with a
> UUID only removes the machine that has to hand the counter out. Treat it as an
> engineering variation, not a new mechanism.

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

> **Prior art:** this is the island model — textbook since
> [Cohoon, Hegde, Martin & Richards (1987) and Tanese (1989)](./REFERENCES.md#-horizontal-gene-transfer-and-breeding):
> isolated subpopulations evolving in parallel with periodic migration. Nothing
> about the topology is new here. NEAT-AI's variation is the machinery that
> makes migrants usable — UUID identity, so a creature bred on one machine
> aligns against a population it has never met.

**Reference**: See Feature #2 in [README.md](../../README.md).

## 5. 💉 CRISPR Gene Injection

**What it is**: Targeted gene insertion during evolution to introduce specific
traits.

**How it works**: Pre-defined gene patterns (connections, neurons, activation
functions) are injected during breeding or mutation phases, allowing domain
knowledge to guide evolution.

**Why it's unique**: Provides a way to incorporate expert knowledge into the
evolutionary process — **standard NEAT has no equivalent.**

> **Prior art:** in the literature this is population seeding / domain-knowledge
> injection —
> [Grefenstette (1987)](./REFERENCES.md#-population-seeding-and-knowledge-injection)
> for the practice,
> [Julstrom (1994)](./REFERENCES.md#-population-seeding-and-knowledge-injection)
> for the measured convergence-versus-diversity trade, and
> [Louis & McDonnell (2004)](./REFERENCES.md#-population-seeding-and-knowledge-injection)
> for injection throughout a run rather than only at generation zero, which is
> the shape CRISPR takes. Standard evolutionary-algorithm practice with a better
> name.

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

> **Prior art:** moving working structure between unrelated individuals is a
> horizontal gene transfer operator; the closest engineering precedent is
> [Barr, Harman, Jia, Marginean & Petke (2015), _Automated Software Transplantation_](./REFERENCES.md#-horizontal-gene-transfer-and-breeding),
> which had the same problem of carrying a transplant's dependencies across.
> **The counter-argument is the point:** standard NEAT refuses cross-species
> crossover deliberately, because of the competing-conventions (permutation)
> problem —
> [Montana & Davis (1989)](./REFERENCES.md#-horizontal-gene-transfer-and-breeding)
> and [Radcliffe (1993)](./REFERENCES.md#-horizontal-gene-transfer-and-breeding)
> — two genomes can encode the same function under different neuron orderings,
> so recombining them destroys both as easily as it combines them. Grafting is a
> deliberate bet against that, not a free win: it pays off only where the
> alignment step finds genuinely corresponding structure.

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

> **Prior art:** the model is
> [Rao & Ballard (1999)](./REFERENCES.md#-predictive-coding); the reason the
> local Hebbian rule above is a legitimate substitute for backpropagation is
> [Whittington & Bogacz (2017)](./REFERENCES.md#-predictive-coding), which
> proved the approximation for a settled network;
> [Millidge, Seth & Buckley (2021)](./REFERENCES.md#-predictive-coding) is the
> review of what the family does and does not buy. NEAT-AI contributes the
> integration — predictive coding on an irregular evolved topology — not the
> learning rule.

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

> **Prior art:** a memory of what has already been tried, consulted before
> proposing again, is the defining structure of tabu search
> ([Glover, 1986](./REFERENCES.md#-surrogate-assisted-search-and-racing)).
> Steering the next proposal by which past proposals paid off is adaptive
> operator selection and credit assignment
> ([Fialho, Da Costa, Schoenauer & Sebag, 2010](./REFERENCES.md#-surrogate-assisted-search-and-racing)).
> The disk-space monitoring is plumbing, with no literature to claim.

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
4. Adaptive temperature tuning targets a ~23.4% acceptance rate.

**Why it's unique**: **Standard NEAT accepts all mutations unconditionally; most
NEAT derivatives use simple fitness-based filtering.** NEAT-AI's MCMC acceptance
lets the population explore broadly early (high temperature) and converge later
(low temperature).

> **Prior art:** the accept/reject rule is
> [Metropolis, Rosenbluth, Rosenbluth, Teller & Teller (1953)](./REFERENCES.md#-markov-chain-monte-carlo-mcmc),
> generalised by
> [Hastings (1970)](./REFERENCES.md#-markov-chain-monte-carlo-mcmc); using it to
> drive a _search_ under a cooling schedule is simulated annealing,
> [Kirkpatrick, Gelatt & Vecchi (1983)](./REFERENCES.md#-markov-chain-monte-carlo-mcmc)
> — the direct ancestor of what this section describes.
>
> **Correction (Issue #3908).** This section used to present the ~23.4% target
> as the optimal acceptance rate, backed by theory. It is not. The figure comes
> from
> [Roberts, Gelman & Gilks (1997)](./REFERENCES.md#-markov-chain-monte-carlo-mcmc),
> an optimal-scaling result for **random-walk Metropolis on a smooth,
> high-dimensional target** — not a result about evolutionary-algorithm
> acceptance rates, where the proposal distribution is a mutation operator and
> the target is not a probability density at all. The knob stays because it
> behaves well in our runs; the appeal to theory is withdrawn. Treat ~23.4% as a
> starting heuristic to tune away from, not a number to converge on.

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

> **Prior art:** stopping one species from starving the others is fitness
> sharing,
> [Goldberg & Richardson (1987)](./REFERENCES.md#-linkage-and-epistasis);
> recombining groups of genes that only work together is linkage learning,
> [Harik & Goldberg (1997)](./REFERENCES.md#-linkage-and-epistasis); subgraph
> transplantation is the transplantation literature cited under
> [🌿 Grafting](#6--grafting-for-incompatible-parents)
> ([Barr et al., 2015](./REFERENCES.md#-horizontal-gene-transfer-and-breeding)),
> and inherits its competing-conventions caveat. Cosine-similarity alignment and
> soft compatibility gating are ours; they are engineering choices, not results.

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
correlations between row directions of the per-neuron gradient.

> **Prior art:** the update is
> [Jordan, Jin, Boza, You, Cesista, Newhouse & Bernstein (2024)](./REFERENCES.md#-orthogonalised-gradient-updates),
> with
> [Bernstein & Newhouse (2024)](./REFERENCES.md#-orthogonalised-gradient-updates)
> for why it helps (steepest descent under a spectral-norm trust region) and
> [Higham (2008)](./REFERENCES.md#-orthogonalised-gradient-updates) for the
> Newton-Schulz iteration itself.
>
> **Caveat (Issue #3908).** The demonstrated benefit is on the large **dense**
> 2-D weight matrices of fixed-architecture networks. A per-neuron fan-in matrix
> in a sparse evolved topology is **small** — often a handful of rows, and a
> plain vector at fan-in 1, where orthogonalisation is a no-op — so the effect
> may be near-nil at production scale. The only measurement we have is
> [`bench/MuonVsBaseline.ts`](../../bench/MuonVsBaseline.ts) on a hand-built
> 4→4→2 creature: 415 → 251 iterations to target error (~40% fewer), ~19%
> cheaper per step (Issue #2529, recorded in
> [the DeepSeek papers index](../archive/research/deepseek-papers-index.md)).
> That is one synthetic topology, not a production population: at production
> topology and sparsity the gain is **unproven**.

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

> **Prior art:** densify, train, sparsify is a well-established recipe —
> [Han et al. (2017), _DSD: Dense-Sparse-Dense Training_](./REFERENCES.md#-pruning-and-sparsity)
> is the direct ancestor, with
> [SET (Mocanu et al., 2018)](./REFERENCES.md#-pruning-and-sparsity) and
> [RigL (Evci et al., 2020)](./REFERENCES.md#-pruning-and-sparsity) as the
> dynamic-sparsity successors that drop and regrow connections throughout
> training. NEAT-AI applies it per topological layer of an evolved network
> rather than to a fixed architecture; the recipe is borrowed whole.

**Configuration**: Opt-in via `syntheticSynapses: true`.

**Reference**: See Feature #22 in [README.md](../../README.md).

## 🔗 Related comparison pages

- [What NEAT-AI implements](./IMPLEMENTED.md) — the full feature breakdown.
- [Ecosystem comparison](./ECOSYSTEM.md) — NEAT-AI vs TensorFlow/PyTorch.
- [References](./REFERENCES.md) — supporting literature.
