# ⚖️ Pros and Cons Analysis

Part of the [Comparison hub](../../COMPARISON.md). A candid trade-off summary
for **[NEAT-AI](../../AGENTS.md#-terminology)** against traditional neural
networks.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

## 🧬 NEAT-AI — Pros

1. **Automatic architecture search**: no need to manually design network
   topology.
2. **Adaptive complexity**: networks grow/shrink based on problem difficulty.
3. **Non-differentiable objectives**: works with objectives that lack gradients.
4. **Extensible inputs**: UUID-based indexing allows adding features without
   restart.
5. **Lifelong learning**: can continuously adapt when you keep older and newer
   data in the training mix, though catastrophic forgetting is still possible if
   the distribution shifts and older patterns drop out.
6. **Interpretable evolution**: can trace how structure evolved over
   generations.
7. **Hybrid training**: combines evolution (exploration) with backprop
   (exploitation).
8. **Unique activations**: supports non-standard functions (IF, MAX, MIN).
9. **Transfer learning**: checkpoint export/import with UUID-based neuron
   mapping and weight freezing, plus DNA-sharing primitives (pruning template,
   knowledge distillation, compact module graft).
10. **ONNX export**: standard format export for interoperability with existing
    ML pipelines.
11. **Comprehensive regularisation**: dropout, L1/L2 weight & bias decay, sparse
    training, neuron pruning, and cost-of-growth penalty.
12. **MCMC exploration/exploitation**: Metropolis-Hastings acceptance with
    adaptive temperature tuning.
13. **Resilient long-running training**: graceful WASM panic recovery and
    forward-only topology enforcement enable robust multi-day runs.
14. **Advanced inter-species breeding**: input-weight crossover, subgraph
    transplantation, and diversity-driven breeding preserve diversity.
15. **Synthetic synapse training**: temporary layer densification gives gradient
    descent a richer search space without permanent inflation.
16. **Diversity preservation**: fitness sharing with per-species breeding
    quotas, stagnant-species retirement, soft compatibility gating, and
    diversity-aware MCMC reheating.
17. **Fitness-driven squash selection**: biases mutation toward activations that
    historically improved fitness in similar neuron roles.
18. **Optional Muon orthogonalisation**: Newton-Schulz orthogonalisation of
    per-neuron gradient matrices for smoother updates.
19. **External Rust scorer**: optional `rust_scorer` CLI for higher
    generation-scoring throughput, with automatic WASM fallback.
20. **Immutable incumbent, one authoritative judge**: candidate generation is
    adventurous — evolution, discovery, and the sibling Rust optimisers all
    propose freely — but acceptance is deliberately boring. The incumbent is
    never edited in place; a candidate is a separate creature, and it is scored
    over the whole corpus by one judge
    ([NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer), or the
    WASM path it falls back to) before it may replace anything. Sampling
    (`trainingSampleRate`) applies to gradient training only, never to the score
    that decides acceptance.
21. **Every experiment is journalled**: each sibling optimiser appends one
    record per experiment to an `experiments.jsonl` journal and ships a `report`
    command over it, so the economics of a strategy — including the strategies
    that turned out not to be worth their runtime — are measurable after the
    fact rather than argued about. That is better practice than most published
    neuroevolution work.

## 🧬 NEAT-AI — Cons

1. **Computational cost**: population-based training requires more resources.
2. **Slower convergence**: evolutionary search is slower than pure gradient
   descent.
3. **Limited scalability**: struggles with very large networks, though "limited"
   is relative — a production-scale network snapshot (~1,700 hidden neurons and
   ~22,000 synapses across 2,461 inputs, captured 2026-06-16) keeps growing. The
   `discoveryDir` feature helps push past this by finding structural
   improvements incrementally.
4. **Sequential processing**: less efficient for pure parallel computation than
   fixed architectures, though topology-aware parallel batch evaluation helps.
5. **Limited unsupervised learning**: NEAT-AI (like standard NEAT) is typically
   used for supervised tasks where labelled data computes fitness. True
   unsupervised learning is not yet implemented — see
   [Future work](./FUTURE_WORK.md#4--unsupervised-learning).
6. **Hyperparameter sensitivity**: many parameters to tune, though adaptive
   population sizing, adaptive mutation thresholds, plateau detection, and
   randomised hyperparameters per run substantially mitigate this (see tip
   below).
7. **No native CUDA**: GPU acceleration uses wgpu (Metal, Vulkan, DX12) with CPU
   fallback rather than native CUDA for NVIDIA GPUs.
8. **Evaluation validity under repeated selection**: every accept/reject
   decision is made against the same corpus and the same scorer, thousands of
   times over, by several independent optimisers. That is **adaptive data
   analysis**: past some volume of queries the incumbent is being fitted to the
   _scorer_ rather than to the data, and each individual accept still looks
   genuinely measured. To answer the question directly — **no corpus slice is
   withheld from every optimiser**. Fitness is scored over the whole dataset
   directory the run is given, and the one holdout mechanism in the library
   (`HoldoutValidator`, Issue #1308) is opt-in, off by default, and splits that
   same corpus for discovery candidates only, so its reserved slice is still
   visible to the fitness evaluation that later accepts the creature. See
   [Dwork et al. (2015) and Blum & Hardt (2015)](./REFERENCES.md#-evaluation-validity);
   the mitigation is future work, not present — see
   [A holdout no optimiser can see](./FUTURE_WORK.md#2--a-holdout-no-optimiser-can-see).
9. **Diversity loss from accept-only optimisation**: NEAT-AI itself hedges
   against this — MCMC acceptance occasionally takes a worse creature,
   speciation and fitness sharing keep sub-populations alive, and reheating is
   diversity-aware. The sibling Rust optimisers (Forests, Ockham, Lamarck,
   Rebase) do not: each is greedy hill-climbing on a single incumbent and only
   ever accepts an improvement.
   [Whitley, Gordon & Mathias (1994)](./REFERENCES.md#-lamarckian-and-baldwinian-evolution)
   measured exactly this trade-off for Lamarckian search — faster convergence,
   earlier loss of diversity — so it is a known property of the deployment
   rather than a surprise. Named mitigation:
   [quality-diversity archives](./FUTURE_WORK.md#1--quality-diversity-and-behavioural-archives).
10. **Operating in the noise regime**: on the production workload, accepted
    improvements are of the order of 1e-04 — one recent fleet comparison turned
    on 5.7e-05. At that scale the point score and the true quality of a creature
    are different quantities, and nothing in the current setup distinguishes a
    robust win from a knife-edge one. Mitigation is future work:
    [robustness as an acceptance criterion](./FUTURE_WORK.md#7--robustness-as-an-acceptance-criterion),
    tracked as a scorer capability in
    [NEAT-AI-scorer#588](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/588).

> [!TIP]
> NEAT-AI handles hyperparameter sensitivity well by randomising values each
> evolution run. In one production deployment, 20+ machines constantly loop with
> random hyperparameters and check the fittest creatures into a shared
> population pool at the end of each run. This has worked effectively for that
> workload without manual tuning, but it is not a universal guarantee.

## 🧠 Traditional Neural Networks — Pros

1. **Fast training**: gradient descent converges quickly with proper learning
   rates.
2. **Proven scalability**: can handle billions of parameters (e.g. GPT-3,
   GPT-4).
3. **Transfer learning**: pre-trained models can be fine-tuned for new tasks.
4. **Efficient inference**: highly optimised for production deployment.
5. **Rich ecosystem**: extensive tooling — see
   [Ecosystem comparison](./ECOSYSTEM.md).
6. **Parallel processing**: highly optimised for GPU parallel computation.
7. **Mature techniques**: well-understood regularisation and optimisation.
8. **Industry standard**: widely used and supported.

## 🧠 Traditional Neural Networks — Cons

1. **Fixed architecture**: requires manual design and tuning.
2. **Gradient dependency**: requires differentiable loss functions.
3. **Catastrophic forgetting**: struggles with continuous learning.
4. **Black box**: limited interpretability.
5. **Data requirements**: needs large labelled datasets.
6. **Rigid inputs**: adding features requires retraining from scratch.
7. **Architecture search**: manual or separate NAS (Neural Architecture Search)
   needed.
8. **Overfitting**: requires careful regularisation for generalisation.

## 🔗 Related comparison pages

- [Training paradigms](./TRAINING_PARADIGMS.md) — how the trade-offs arise.
- [Future work](./FUTURE_WORK.md) — where NEAT-AI still lags the state of the
  art.
- [References](./REFERENCES.md) — supporting literature.
