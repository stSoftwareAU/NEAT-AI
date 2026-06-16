# ⚖️ Pros and Cons Analysis

Part of the [Comparison hub](../../COMPARISON.md). A candid trade-off summary
for **[NEAT-AI](../../AGENTS.md#-terminology)** against traditional neural
networks.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** The pros below that derive from the genetic substrate
> (population-based search, speciation) are inherited from standard
> [NEAT](../../AGENTS.md#-terminology); the gradient training, regularisation,
> MCMC, transfer learning, and tooling pros are NEAT-AI extensions. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use).

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
12. **Self-tuning hyperparameters**: per-creature evolvable learning rate,
    mutation rates, and regularisation strength.
13. **MCMC exploration/exploitation**: Metropolis-Hastings acceptance with
    adaptive temperature tuning.
14. **Resilient long-running training**: graceful WASM panic recovery and
    forward-only topology enforcement enable robust multi-day runs.
15. **Advanced inter-species breeding**: input-weight crossover, subgraph
    transplantation, and diversity-driven breeding preserve diversity.
16. **Synthetic synapse training**: temporary layer densification gives gradient
    descent a richer search space without permanent inflation.
17. **Diversity preservation**: fitness sharing with per-species breeding
    quotas, stagnant-species retirement, soft compatibility gating, and
    diversity-aware MCMC reheating.
18. **Fitness-driven squash selection**: biases mutation toward activations that
    historically improved fitness in similar neuron roles.
19. **Optional Muon orthogonalisation**: Newton-Schulz orthogonalisation of
    per-neuron gradient matrices for smoother updates.
20. **External Rust scorer**: optional `rust_scorer` CLI for higher
    generation-scoring throughput, with automatic WASM fallback.

## 🧬 NEAT-AI — Cons

1. **Computational cost**: population-based training requires more resources.
2. **Slower convergence**: evolutionary search is slower than pure gradient
   descent.
3. **Limited scalability**: struggles with very large networks. In production we
   max out around 500 hidden neurons and 16,000 synapses; the `discoveryDir`
   feature helps push past this by finding structural improvements
   incrementally.
4. **Sequential processing**: less efficient for pure parallel computation than
   fixed architectures, though topology-aware parallel batch evaluation helps.
5. **Limited unsupervised learning**: NEAT-AI (like standard NEAT) is typically
   used for supervised tasks where labelled data computes fitness. True
   unsupervised learning is not yet implemented — see
   [Future work](./FUTURE_WORK.md#2--unsupervised-learning).
6. **Hyperparameter sensitivity**: many parameters to tune, though per-creature
   hyperparameter self-adaptation, adaptive population sizing, adaptive mutation
   thresholds, plateau detection, stability adaptation, and randomised
   hyperparameters per run substantially mitigate this (see tip below).
7. **No native CUDA**: GPU acceleration uses wgpu (Metal, Vulkan, DX12) with CPU
   fallback rather than native CUDA for NVIDIA GPUs.

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
