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

## 🔴 High priority

### 1. 🔁 Transfer Learning Support

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

### 2. 🔓 Unsupervised Learning

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

### 3. 👁️ Attention Mechanisms

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

### 4. ⚡ Batch Processing Optimisation

**Current state**: Parallel batch creature evaluation with topology-aware
grouping is implemented (Issue #1862), along with batch discovery validation and
mini-batch gradient descent.

**What we have**:

- ✅ **Parallel batch creature evaluation** (`ParallelEvaluationConfig`):
  topology-aware grouping maximises WASM compilation cache hits, with
  configurable concurrency via `maxConcurrentEvaluations`.
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

### 5. 🎯 Multi-Task Learning

**Current state**: Single-objective optimisation. Each creature optimises for
one task.

**What's missing**: multi-objective fitness functions, Pareto-optimal solution
tracking, task-specific output heads, and shared representation learning.

**Impact**: more efficient learning; networks that solve multiple problems.

**References**:

- [Multi-Task Learning Survey](https://arxiv.org/abs/1706.05098) — Ruder (2017).
- [Multi-Objective Optimization](https://en.wikipedia.org/wiki/Multi-objective_optimization)
  — Wikipedia.

### 6. 🛡️ Advanced Regularisation Techniques

**Current state**: Comprehensive regularisation suite including dropout, L1/L2
weight & bias decay, sparse training, pruning, cost-of-growth penalty, and
cross-validation.

**What we have**:

- ✅ **Dropout** (Issue #1860): true inverted dropout.
- ✅ **L1/L2 weight & bias regularisation** (Issue #1859), applied during
  backpropagation via `WeightRegularisationConfig` and
  `BiasRegularisationConfig`.
- ✅ **Cross-validation** (Issue #1865): K-fold with validation-based early
  stopping and single-split fallback.
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

### 7. 🔧 Hyperparameter Evolution

**Current state**: Per-creature hyperparameter self-adaptation with adaptive
population sizing is implemented (Issue #1863).

**What we have**:

- ✅ **Per-creature hyperparameter self-adaptation**: learning rate, mutation
  rates, and regularisation strength as evolvable parameters with Gaussian
  mutation and weighted-average crossover.
- ✅ **Adaptive population sizing** (`AdaptivePopulationConfig`): adjusts size
  based on species diversity metrics.
- **Adaptive mutation thresholds** (`AdaptiveMutationThresholds`): large
  creatures (≥300 neurons) receive 90% weight/bias mutations, with linear
  interpolation for medium creatures (100–299 neurons).
- **Plateau detection** (`PlateauDetector`): adapts mutation rates on plateaus.
- **Stability adaptation** (`StabilityAdaptationConfig`): adapts mutation and
  breeding based on validation stability.

**What's still missing**: meta-learning for hyperparameters (learning to learn
across tasks).

**Impact**: reduced manual tuning, better default configurations.

**References**:

- [Hyperparameter Optimization](https://arxiv.org/abs/1206.2944) — Bergstra &
  Bengio (2012).
- [AutoML](https://www.automl.org/).

### 8. 🖥️ Cross-Platform GPU Support

**Current state**: Cross-platform GPU acceleration via the wgpu abstraction
layer.

> [!NOTE]
> GPU acceleration uses wgpu, which automatically selects the best available
> backend: Metal on macOS, Vulkan on Linux, and DX12 on Windows. When no
> compatible GPU is detected, discovery gracefully falls back to CPU.

**What's implemented**:

- ✅ Automatic backend selection via wgpu (Metal, Vulkan, DX12, OpenGL).
- ✅ CPU fallback when no compatible GPU is available.
- ✅ GPU backend detection and reporting (`getGpuBackendInfo()`).
- ✅ Cross-platform `requireGpu: false` — GPU accelerates but is not required.

**What's missing**: native CUDA for NVIDIA GPUs (wgpu uses Vulkan on Linux),
OpenCL for older hardware, and benchmarking across all platforms.

**Impact**: broader hardware support.

**References**:

- [wgpu Documentation](https://wgpu.rs/).
- [Vulkan](https://www.vulkan.org/).
- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/).

## 🟢 Low priority

### 9. 🔍 Advanced Interpretability Tools

**Current state**: Basic visualisation of network structure.

**What's missing**: activation visualisation, feature-importance analysis,
evolutionary-path visualisation, decision-boundary visualisation, saliency maps.

**Impact**: better understanding of evolved solutions; debugging capabilities.

**References**:

- [Interpretable Machine Learning](https://christophm.github.io/interpretable-ml-book/)
  — Molnar (2020).
- [Feature Visualization](https://distill.pub/2017/feature-visualization/) —
  Olah et al. (2017).

### 10. 📦 Standard Format Export

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

### 11. 🕹️ Reinforcement Learning Support

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

### 12. 📈 Time Series and Sequence Modelling

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
