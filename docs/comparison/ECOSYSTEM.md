# 🔬 Ecosystem Comparison: NEAT-AI vs Standard Libraries

Part of the [Comparison hub](../../COMPARISON.md). This page contrasts
**[NEAT-AI](../../AGENTS.md#-terminology)** with the mainstream deep-learning
toolchain (TensorFlow, PyTorch, Keras, scikit-learn).

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

## 📚 Standard ML Libraries (TensorFlow, PyTorch, etc.)

**What they provide**:

- Pre-built neural network layers (Dense, Conv2D, LSTM, etc.).
- Automatic differentiation (computes gradients automatically).
- Optimisers (Adam, SGD, etc.) with proven hyperparameters.
- Data loaders and preprocessing utilities.
- Model serialisation formats (SavedModel, ONNX, etc.).
- Visualisation tools (TensorBoard, etc.).
- Pre-trained models (ImageNet, BERT, GPT, etc.).
- Large community and extensive documentation.

**What NEAT-AI provides instead** (standard NEAT contribution noted in italics;
everything else is a NEAT-AI extension):

- _Genetic operations: speciation, crossover, mutation with historical marking
  (standard NEAT)._
- **Evolutionary architecture search**: no need to design layers — structure
  evolves.
- **Dynamic topology**: networks grow/shrink during training.
- **UUID-based extensibility**: add features without restarting.
- **Memetic evolution**: hybrid evolution + backpropagation.
- **Error-guided discovery**: GPU-accelerated structural hints.
- **Distributed evolution**: multi-machine evolution with centralised
  combination.
- **Unique activations**: IF, MAX, MIN and other non-standard functions.
- **MCMC acceptance**: Metropolis-Hastings mutation acceptance with adaptive
  temperature.
- **Synthetic synapses**: temporary dense connectivity for gradient descent.
- **Advanced breeding**: multiple strategies for incompatible parent crossover.
- **WASM resilience**: graceful panic recovery in long-running evolution.

## ⚖️ Capability matrix

| Capability                 | Standard libraries (TF/PyTorch) | NEAT-AI                                   |
| -------------------------- | ------------------------------- | ----------------------------------------- |
| Architecture design        | Manual (you design the layers)  | Automatic (topology evolves)              |
| Topology during training   | Static                          | Dynamic (grow/shrink)                     |
| Gradient training          | ✅ Autodiff                     | ✅ Backpropagation (NEAT-AI extension)    |
| Non-differentiable rewards | ❌ Needs differentiable loss    | ✅ Direct fitness on any scalar score     |
| Adding input features      | Retrain from scratch            | ✅ UUID-keyed, no restart                 |
| Distributed training       | Data/model parallel             | ✅ Island model + centralised combination |
| Pre-trained model zoo      | ✅ Extensive                    | ❌ None (transfer via checkpoints/ONNX)   |
| Interchange format         | SavedModel, ONNX                | ✅ ONNX export + custom JSON              |
| Ecosystem maturity         | ✅ Industry standard            | 🟡 Focused, single-purpose                |

## 🔀 Key differences

- **Standard libraries**: you design the architecture, they handle training.
- **NEAT-AI**: architecture evolves automatically; NEAT-AI handles both
  structure and training.
- **Standard libraries**: fixed architectures, transfer learning from
  pre-trained models.
- **NEAT-AI**: dynamic architectures with transfer learning via checkpoint
  export/import, and ONNX export for interoperability.

## 🧭 When to use each

- **Use standard libraries**: when you have a proven architecture (CNN for
  images, Transformer for language), need pre-trained models, or want
  industry-standard tooling.
- **Use NEAT-AI**: when you need automatic architecture search, have
  non-differentiable objectives, want to add features incrementally, or need
  lifelong learning.

## 📚 References

- [TensorFlow](https://www.tensorflow.org/) — Google's ML framework.
- [PyTorch](https://pytorch.org/) — Meta's ML framework.
- [Keras](https://keras.io/) — high-level neural networks API.
- [scikit-learn](https://scikit-learn.org/) — traditional ML library.

## 🔗 Related comparison pages

- [Pros and cons](./PROS_AND_CONS.md) — the trade-offs distilled.
- [Future work](./FUTURE_WORK.md) — gaps versus the state of the art.
- [References](./REFERENCES.md) — supporting literature.
