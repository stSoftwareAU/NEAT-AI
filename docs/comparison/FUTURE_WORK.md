# 🚧 Shortcomings and Future Work

Part of the [Comparison hub](../../COMPARISON.md). This page identifies gaps in
**[NEAT-AI](../../AGENTS.md#-terminology)** compared to state-of-the-art
approaches. These represent opportunities for future development and can serve
as a task list.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

The gaps are grouped into high, medium, and low priority below.

> [!NOTE]
> The items below are listed in rough priority order. High-priority gaps have
> the greatest impact on practical usability; low-priority items are
> enhancements that would broaden the library's reach.

**Two kinds of gap appear below.** Most are about **reach** — unsupervised
learning, multi-task learning, attention, sequence modelling: things NEAT-AI
cannot yet do. Gaps 1, 2 and 7 are a different kind: they are about the
**trustworthiness of the results NEAT-AI already produces**, and they are the
named mitigations for cons 8–10 in
[Pros and cons](./PROS_AND_CONS.md#-neat-ai--cons). A result that cannot be
trusted is worth less than a capability that does not exist yet, so the
trustworthiness gaps sort above the reach-extending ones inside each tier.

## 🔴 High priority

### 1. 🎨 Quality-Diversity and Behavioural Archives

**Current state**: NEAT-AI keeps a population with speciation, fitness sharing
and islands, but every optimiser in the fleet — NEAT-AI's own accept step and
the sibling Rust optimisers — ultimately drives a **single incumbent** forward
and only keeps what beats it. That is a local-optimum machine by construction,
and it is the named answer to
[con 9, diversity loss from accept-only optimisation](./PROS_AND_CONS.md#-neat-ai--cons).

**What's missing**: an archive of high-performing solutions that differ
**behaviourally** rather than one champion — a behaviour descriptor per
creature, a MAP-Elites-style grid or novelty archive keyed on it, and breeding
that draws from the archive rather than only from the incumbent's species.
Speciation and islands already provide most of the machinery; what is absent is
the behaviour descriptor and the archive keyed on it.

**Impact**: escapes local optima the hill-climb cannot. Worth noting that
quality-diversity methods frequently find better _single_ solutions than a pure
hill-climb aiming for exactly that — the diversity is the means, not only the
end.

**References**:

- [Abandoning Objectives: Evolution through the Search for Novelty Alone](https://doi.org/10.1162/EVCO_a_00025)
  — Lehman & Stanley (2011) — novelty search.
- [Illuminating Search Spaces by Mapping Elites](https://arxiv.org/abs/1504.04909)
  — Mouret & Clune (2015) — MAP-Elites.

### 2. 📏 A Holdout No Optimiser Can See

**Current state**: **no corpus slice is withheld from every optimiser** — see
[con 8, evaluation validity under repeated selection](./PROS_AND_CONS.md#-neat-ai--cons).
Fitness is scored over the whole dataset directory a run is given; the library's
`HoldoutValidator` (Issue #1308) is opt-in, off by default, and splits that same
corpus for discovery candidates only, so its reserved slice is still visible to
the fitness evaluation that later accepts the creature.

**What's missing**: a slice of the corpus that no optimiser — not NEAT-AI, not
Discovery, not the sibling Rust optimisers — ever scores against, plus a
reporting rule over it. Blum & Hardt's Ladder is a drop-in shape: report an
improvement only when it beats the previous best by more than the evaluation
noise, so the number of effective queries against the reserved slice stays
bounded no matter how many candidates were tried.

**Impact**: reported improvements become claims about the data rather than about
the scorer. Without it, every headline number carries an unbounded adaptivity
debt.

**References**:

- [The Reusable Holdout: Preserving Validity in Adaptive Data Analysis](https://doi.org/10.1126/science.aaa9375)
  — Dwork et al. (2015).
- [The Ladder: A Reliable Leaderboard for Machine Learning Competitions](https://arxiv.org/abs/1502.04585)
  — Blum & Hardt (2015).

### 3. 🔁 Transfer Learning Support

**Current state**: ✅ Implemented (Issue #1861). Checkpoint export/import with
UUID-based neuron and synapse mapping enables reuse of trained creatures across
related tasks with different input/output configurations.

**What we have**:

- ✅ **Checkpoint export/import** via the `Checkpoint` class with full topology
  and weight serialisation.
- ✅ **UUID-based neuron mapping** so creatures with different topologies can
  share compatible sub-networks.
- ✅ **Weight freezing** (`freezeHidden`) so only new connections are trained.
- ✅ **Population seeding** (`createSeededPopulation()`) from pre-trained
  creatures.
- ✅ **DNA-sharing primitives** (Issues #2491–#2496): `PruningTemplateStrategy`
  (recommended winner), `KnowledgeDistillation`, and `CompactModuleGraft`. The
  fourth candidate, `KnobTuningStrategy`, was retired in #3554 after measuring
  zero lift. See
  [dna-sharing-bake-off-results.md](../dna-sharing-bake-off-results.md).

**What's still missing**: multi-task learning capabilities.

**References**:

- [Transfer Learning](https://en.wikipedia.org/wiki/Transfer_learning) —
  Wikipedia overview.
- [Transfer Learning Survey](https://arxiv.org/abs/1808.01974) — Pan & Yang.
- [How Transferable Are Features in Deep Neural Networks?](https://arxiv.org/abs/1411.1792)
  — Yosinski et al. (2014).
- [Knowledge Distillation](https://arxiv.org/abs/1503.02531) — Hinton et al.
  (2015).

### 4. 🔓 Unsupervised Learning

**Current state**: Both standard NEAT and NEAT-AI are typically used for
supervised tasks where labelled data computes fitness scores. True unsupervised
learning (learning patterns from unlabelled data) is **not yet implemented** in
NEAT-AI.

> [!NOTE]
> Evolution is "unsupervised" in the sense that the algorithm doesn't need
> gradients or labelled examples to guide weight updates. However, you still
> typically need labelled data to compute fitness scores. True unsupervised
> learning means learning patterns, representations, or structures from
> unlabelled data without any target labels.

**What's missing**: autoencoder architectures, generative models (VAE,
GAN-like), clustering and dimensionality reduction, self-supervised objectives,
and unsupervised fitness functions (reconstruction error, clustering quality).

**Impact**: broader applicability, ability to learn from unlabelled data.

**References**:

- [Autoencoders](https://en.wikipedia.org/wiki/Autoencoder) — Wikipedia.
- [Variational Autoencoders](https://arxiv.org/abs/1312.6114) — Kingma &
  Welling.
- [Generative Adversarial Networks](https://arxiv.org/abs/1406.2661) —
  Goodfellow et al. (2014).
- [Unsupervised Learning](https://en.wikipedia.org/wiki/Unsupervised_learning) —
  Wikipedia.

### 5. 👁️ Attention Mechanisms

**Current state**: No built-in attention mechanisms for sequence tasks.

**What's missing**: self-attention layers that can evolve, multi-head attention,
position encoding for sequences, and attention-based memory mechanisms.

**Impact**: better performance on sequential data and natural-language tasks.

**References**:

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — Vaswani et al.
  (2017).
- [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/)
  — Jay Alammar.
- [Augmented RNNs](https://distill.pub/2016/augmented-rnns/) — Olah & Carter.

### 6. ⚡ Batch Processing Optimisation

**Current state**: Parallel batch creature evaluation with topology-aware
grouping is implemented (Issue #1862), along with batch discovery validation and
mini-batch gradient descent.

**What we have**:

- ✅ **Parallel batch creature evaluation** (`ParallelEvaluationConfig`):
  topology-aware grouping maximises WASM compilation cache hits, spread across
  every worker in the fast pool.
- **Batch discovery validation** (`BatchDiscoveryValidator`): validates multiple
  candidates per call with type-based grouping, result caching, and early-exit.
- **Mini-batch gradient descent**: configurable batch sizes for backpropagation.

**What's still missing**: vectorised operations across creatures,
GPU-accelerated forward passes, and batch inference optimisation.

**Impact**: faster training on large datasets, better GPU utilisation.

**References**:

- [Batch Normalization](https://arxiv.org/abs/1502.03167) — Ioffe & Szegedy.
- [PyTorch tuning guide](https://pytorch.org/tutorials/recipes/recipes/tuning_guide.html).

## 🟡 Medium priority

### 7. 🛡️ Robustness as an Acceptance Criterion

**Current state**: acceptance compares **point scores**. On the production
workload the accepted improvements are of the order of 1e-04, so a win and the
evaluation noise are the same size, and nothing distinguishes a creature sitting
in a flat basin from one balanced on a knife edge — see
[con 10, operating in the noise regime](./PROS_AND_CONS.md#-neat-ai--cons).

**What's missing**: accepting on a **perturbed** objective rather than the point
score — score the candidate under small weight perturbations and accept on the
worst case (or the mean) instead of the single measurement. Tracked as a scorer
capability in
[NEAT-AI-scorer#588](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/588),
since the judge is where the perturbation has to happen for every optimiser to
inherit it.

**Impact**: accepted wins survive contact with data the creature has not seen; a
knife-edge candidate is rejected before it becomes the incumbent.

**References**:

- [Flat Minima](https://doi.org/10.1162/neco.1997.9.1.1) — Hochreiter &
  Schmidhuber (1997).
- [On Large-Batch Training for Deep Learning: Generalization Gap and Sharp Minima](https://arxiv.org/abs/1609.04836)
  — Keskar et al. (2017).
- [Sharpness-Aware Minimization](https://arxiv.org/abs/2010.01412) — Foret et
  al. (2021), SAM.

### 8. 🎯 Multi-Task Learning

**Current state**: Single-objective optimisation. Each creature optimises for
one task.

**What's missing**: multi-objective fitness functions, Pareto-optimal solution
tracking, task-specific output heads, and shared representation learning.

**Impact**: more efficient learning; networks that solve multiple problems.

**References**:

- [Multi-Task Learning Survey](https://arxiv.org/abs/1706.05098) — Ruder (2017).
- [Multi-Objective Optimization](https://en.wikipedia.org/wiki/Multi-objective_optimization)
  — Wikipedia.

### 9. 🛡️ Advanced Regularisation Techniques

**Current state**: Comprehensive regularisation suite including dropout, L1/L2
weight & bias decay, sparse training, pruning, and a cost-of-growth penalty.

**What we have**:

- ✅ **Dropout** (Issue #1860): true inverted dropout.
- ✅ **L1/L2 weight & bias regularisation** (Issue #1859), applied during
  backpropagation via `WeightRegularisationConfig` and
  `BiasRegularisationConfig`.
- **Sparse training**: configurable `sparseRatio`.
- **Neuron pruning**: automatic removal of non-contributing neurons.
- **Cost-of-growth**: penalty for network size.
- **Hard limits**: per-mutation change limits and maximum absolute weight/bias.

**What's still missing**: batch-normalisation evolution.

**Impact**: better generalisation, reduced overfitting.

**References**:

- [Dropout](https://arxiv.org/abs/1207.0580) — Srivastava et al. (2014).
- [Batch Normalization](https://arxiv.org/abs/1502.03167) — Ioffe & Szegedy.
- [Regularization in Deep Learning](https://www.deeplearningbook.org/contents/regularization.html)
  — Deep Learning Book.

### 10. 🔧 Hyperparameter Evolution

**Current state**: Adaptive population sizing is implemented (Issue #1863).
Per-creature hyperparameter self-adaptation was implemented alongside it but
withdrawn in Issue #3569 — the feature was complete and tested, yet its
`enabled` flag was never turned on by any consumer, so it carried a genome field
and a 13-field config surface for no measured benefit.

**What we have**:

- ✅ **Adaptive population sizing** (`AdaptivePopulationConfig`): adjusts size
  based on species diversity metrics.
- **Adaptive mutation thresholds** (`AdaptiveMutationThresholds`): large
  creatures (≥300 neurons) receive 90% weight/bias mutations, with linear
  interpolation for medium creatures (100–299 neurons).
- **Plateau detection** (`PlateauDetector`): adapts mutation rates on plateaus.

**What's still missing**: per-creature hyperparameter self-adaptation (see above
— a prior implementation was withdrawn as unused, so any revival should land
with a consumer that enables it), and meta-learning for hyperparameters
(learning to learn across tasks).

**Impact**: reduced manual tuning, better default configurations.

**References**:

- [Hyperparameter Optimization](https://arxiv.org/abs/1206.2944) — Bergstra &
  Bengio (2012).
- [AutoML](https://www.automl.org/).

### 11. 🖥️ Cross-Platform GPU Support

**Current state**: Cross-platform GPU acceleration via the wgpu abstraction
layer.

> [!NOTE]
> GPU acceleration uses wgpu, which automatically selects the best available
> backend: Metal on macOS, Vulkan on Linux, and DX12 on Windows. Discovery
> analysis is GPU-only — when no compatible GPU is detected the analysis pass is
> refused and yields no proposals (see
> [GPU_ACCELERATION.md](../GPU_ACCELERATION.md)).

**What's implemented**:

- ✅ Automatic backend selection via wgpu (Metal, Vulkan, DX12, OpenGL).
- ✅ A graceful refusal — not a thread panic — when no GPU adapter is present.
- ✅ GPU backend detection and reporting (`getGpuBackendInfo()`).

**What's missing**: native CUDA for NVIDIA GPUs (wgpu uses Vulkan on Linux),
OpenCL for older hardware, and benchmarking across all platforms.

**Impact**: broader hardware support.

**References**:

- [wgpu Documentation](https://wgpu.rs/).
- [Vulkan](https://www.vulkan.org/).
- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/).

## 🟢 Low priority

### 12. 🔍 Advanced Interpretability Tools

**Current state**: Basic visualisation of network structure.

**What's missing**: activation visualisation, feature-importance analysis,
evolutionary-path visualisation, decision-boundary visualisation, saliency maps.

**Impact**: better understanding of evolved solutions; debugging capabilities.

**References**:

- [Interpretable Machine Learning](https://christophm.github.io/interpretable-ml-book/)
  — Molnar (2020).
- [Feature Visualization](https://distill.pub/2017/feature-visualization/) —
  Olah et al. (2017).

### 13. 📦 Standard Format Export

**Current state**: ✅ ONNX export implemented (Issue #1866). Custom JSON format
remains for internal serialisation.

**What we have**:

- ✅ **ONNX export**: converts creature topology to ONNX computational graphs
  (each neuron mapped to weighted sum → bias → activation), with compatibility
  checking via `checkOnnxCompatibility()` for unsupported features (IF/MINIMUM/
  MAXIMUM aggregates and recurrent connections).

**What's still missing**: TensorFlow Lite export for mobile, CoreML export for
Apple devices, and PyTorch model conversion.

**Impact**: integration with existing ML pipelines; deployment flexibility.

**References**:

- [ONNX](https://onnx.ai/).
- [TensorFlow Lite](https://www.tensorflow.org/lite).
- [CoreML](https://developer.apple.com/machine-learning/core-ml/).

### 14. 🕹️ Reinforcement Learning Support

**Current state**: NEAT-AI is a direct policy-search method for episode-based RL
(see [Training paradigms](./TRAINING_PARADIGMS.md#-reinforcement-learning)), but
value-based and policy-gradient integrations are not provided.

**What's missing**: Q-learning integration, policy-gradient methods,
actor-critic architectures, and built-in reward shaping.

**Impact**: closer parity with value-based RL on dense-reward tasks.

**References**:

- [Reinforcement Learning: An Introduction](http://incompleteideas.net/book/) —
  Sutton & Barto (2018).
- [Deep Q-Networks](https://arxiv.org/abs/1312.5602) — Mnih et al. (2013).
- [Proximal Policy Optimization](https://arxiv.org/abs/1707.06347) — Schulman et
  al. (2017).

### 15. 📈 Time Series and Sequence Modelling

**Current state**: Primarily feedforward, but basic recurrent/time-series
support exists via the `feedbackLoop` configuration.

**What we have**:

- **Feedback loop**: `feedbackLoop` in `NeatArguments` enables recurrent
  connections (self-loops and backward connections), where the previous
  activation feeds back into the next interaction. When enabled, recurrent
  mutations (`ADD_BACK_CONN`, `ADD_SELF_CONN`, etc.) become available, letting
  networks evolve memory-like structures for time-series forecasting. See the
  [NARX feedback networks](https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html)
  reference.

**What's still missing**: LSTM/GRU-like gated structures, temporal-convolution
evolution, sequence-to-sequence architectures, and temporal attention.

**Impact**: better handling of time series, natural language, and sequential
data.

**References**:

- [Long Short-Term Memory](https://www.bioinf.jku.at/publications/older/2604.pdf)
  — Hochreiter & Schmidhuber (1997).
- [Sequence to Sequence Learning](https://arxiv.org/abs/1409.3215) — Sutskever
  et al. (2014).

## 🔗 Related comparison pages

- [What NEAT-AI implements](./IMPLEMENTED.md) — features already shipped.
- [Pros and cons](./PROS_AND_CONS.md) — current trade-offs.
- [References](./REFERENCES.md) — supporting literature.
