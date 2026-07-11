# 🎓 Training Paradigms

Part of the [Comparison hub](../../COMPARISON.md). This page compares how
**[NEAT-AI](../../AGENTS.md#-terminology)** is trained against the gradient-only
paradigm of traditional neural networks, and explains where NEAT-AI sits in the
reinforcement-learning landscape.

> [!IMPORTANT]
> **NEAT-AI ≠ NEAT.** **NEAT** means the original 2002 algorithm; **NEAT-AI**
> means this project — they are no longer the same thing. See the
> [NEAT vs NEAT-AI rule](../../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
> for the one canonical statement of the convention.

## 🧠 Traditional Neural Networks

**Training approach**:

- **Backpropagation**: Gradient-based weight updates using the chain rule.
- **Fixed Architecture**: Structure determined before training begins.
- **Batch Training**: Process multiple samples simultaneously for efficiency.
- **Static Learning**: Architecture doesn't change during training.
- **Transfer Learning**: Pre-trained models can be fine-tuned for new tasks.
- **Supervised Learning**: Requires labelled datasets.

**Strengths**:

- Fast convergence with gradient descent.
- Proven scalability to billions of parameters.
- Rich ecosystem of tools and frameworks.
- Highly optimised for GPU parallel processing.

**Weaknesses**:

- Requires manual architecture design.
- Needs differentiable loss functions.
- Catastrophic forgetting in continuous learning.
- Limited interpretability (black box).
- Rigid input/output dimensions.

## 🧬 NEAT-AI

**Training approach** (standard NEAT contribution in italics; everything else is
a NEAT-AI extension):

- _Genetic operations: mutation, crossover, speciation (standard NEAT)._
- **Hybrid Approach**: combines evolutionary search with backpropagation —
  standard NEAT has no gradient step.
- **Dynamic Architecture**: structure evolves during training (inherits standard
  NEAT's evolving topology).
- **Backpropagation**: gradient-based weight optimisation (fully implemented;
  not present in standard NEAT).
- **Memetic Learning**: records and reuses successful weight patterns; on
  NEAT-AI's internal workloads this hybrid step has often converged faster than
  pure backpropagation in practice.
- **Error-Guided Discovery**: GPU-accelerated structural hints based on error
  analysis — standard NEAT mutates structure uniformly at random.
- **Population-Based**: evolves multiple networks simultaneously (inherited from
  standard NEAT).
- **Regularisation**: dropout, L1/L2 weight & bias decay, sparse training,
  neuron pruning, and cost-of-growth penalty.
- **Cross-Validation**: K-fold validation for robust fitness estimation.
- **Transfer Learning**: checkpoint export/import with weight freezing for
  fine-tuning on related tasks.
- **MCMC Mutation Acceptance**: Metropolis-Hastings criterion with adaptive
  temperature tuning for accepting/rejecting mutations — standard NEAT accepts
  all mutations unconditionally.
- **Synthetic Synapses**: temporary dense inter-layer connectivity during
  backpropagation, pruned after training.
- **Advanced Breeding**: input-weight crossover, subgraph transplantation
  (horizontal gene transfer), diversity-driven breeding, and cosine-similarity
  neuron alignment for genetically incompatible creatures — standard NEAT
  refuses crossover between incompatible parents.

**Strengths**:

- Automatic architecture search.
- Adaptive complexity (grows/shrinks as needed).
- Works with non-differentiable objectives.
- Extensible inputs/outputs via UUID indexing.
- Lifelong learning support for long-running deployments (continuous training as
  new data arrives), with the degree of catastrophic forgetting depending on how
  you construct and refresh your training data.
- Can trace evolutionary history.
- Transfer learning via checkpoint export/import with UUID-based neuron mapping.
- ONNX export for interoperability with standard ML tooling.

**Weaknesses**:

- More computationally expensive (population-based).
- Slower convergence than pure gradient descent.
- Limited scalability compared to massive transformers.
- Less efficient for pure parallel processing.

## 🎮 Reinforcement Learning

NEAT-AI is a **direct policy search** method for episode-based reinforcement
learning (RL): each creature is a candidate policy, and the rollout score
(cumulative reward, optionally with shaping penalties) is its fitness. Compared
to value-based RL ([DQN](https://www.nature.com/articles/nature14236)) and
policy-gradient methods ([PPO](https://arxiv.org/abs/1707.06347), REINFORCE),
NEAT-AI (like standard NEAT) does not learn a value function and does not
differentiate through the policy — both evolve the network's topology and
weights directly against a scalar episode score. This means the reward can be
sparse, discontinuous, or provided only by a black-box simulator; the action
decoder need not be differentiable; and the policy architecture grows with the
task instead of being chosen up front.

The cost is sample efficiency per environment step — when a dense,
differentiable reward is available, DQN or PPO usually converge in fewer
simulator steps. Where NEAT-AI wins is in parallelism (rollouts are
embarrassingly parallel across the population) and robustness to
non-differentiable objectives. The streaming primitive is `Creature.activate`,
called once per simulator tick; the canonical episode-rollout loop and
worked-example link are documented in
[REINFORCEMENT_LEARNING.md](../REINFORCEMENT_LEARNING.md).

## 🔗 Related comparison pages

- [Architectural comparison](./ARCHITECTURES.md) — the topologies being trained.
- [Unique approaches](./UNIQUE_APPROACHES.md) — memetic evolution, MCMC,
  synthetic synapses, and more.
- [Pros and cons](./PROS_AND_CONS.md) — the trade-offs distilled.
- [References](./REFERENCES.md) — supporting literature.
