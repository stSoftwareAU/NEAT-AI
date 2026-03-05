# Activation Functions Guide

This guide covers all activation functions available in NEAT-AI, helps you
understand their characteristics, and provides guidance on selecting the right
function for your use case.

## What Is an Activation Function?

An activation function (called a **squash** function in NEAT-AI) transforms a
neuron's raw input into its output value. Without activation functions, a neural
network would only be able to learn linear relationships — activation functions
introduce non-linearity, enabling the network to learn complex patterns.

In NEAT-AI, each neuron can have its own activation function. This is more
flexible than traditional neural networks, where all neurons in a layer
typically share the same function. NEAT's topology evolution can discover which
activation works best for each neuron's role in the network.

### Key Terms

- **Squash function**: NEAT-AI's term for an activation function.
- **Vanishing gradient**: A problem where the derivative (slope) of an
  activation function becomes very small, causing learning to slow or stop. This
  happens when neurons become "saturated" — their inputs are in a region where
  the function is nearly flat.
- **Dead neuron**: A neuron that always outputs zero (or a constant), so it
  stops contributing to the network. Common with ReLU when inputs are always
  negative.
- **Bounded**: The output is restricted to a fixed range (e.g., [0, 1]).
  Unbounded functions can output any value.
- **Monotonic**: The output always increases (or always decreases) as the input
  increases. Non-monotonic functions can go up and down.

---

## Overview Table

The table below lists every activation function available in NEAT-AI. **Mutation
probability** controls how often NEAT's evolution selects a function when
mutating neurons — higher values mean the function is chosen more frequently.

### Standard Activation Functions

| Name            | Output Range  | Bounded | Monotonic | Mutation Prob. | Summary                                         |
| :-------------- | :------------ | :-----: | :-------: | :------------: | :---------------------------------------------- |
| LeakyReLU       | (-inf, inf)   |   No    |    Yes    |       36       | Like ReLU but allows small negative outputs     |
| Swish           | (~-0.28, inf) |   No    |    No     |       35       | Smooth, self-gated function                     |
| GELU            | (~-0.17, inf) |   No    |    No     |       34       | Gaussian-weighted smooth activation             |
| ELU             | [-1, inf)     |   No    |    Yes    |       33       | Exponential for negatives, linear for positives |
| SELU            | (-inf, inf)   |   No    |    Yes    |       32       | Self-normalising variant of ELU                 |
| Mish            | (~-0.31, inf) |   No    |    No     |       31       | Smooth, non-monotonic, self-regularising        |
| TANH            | (-1, 1)       |   Yes   |    Yes    |       30       | Classic bounded activation                      |
| LOGISTIC        | (0, 1)        |   Yes   |    Yes    |       25       | Classic sigmoid function                        |
| Softplus        | (0, inf)      |   No    |    Yes    |       24       | Smooth approximation of ReLU                    |
| ArcTan          | (-pi/2, pi/2) |   Yes   |    Yes    |       23       | Bounded, smooth, always has non-zero slope      |
| SOFTSIGN        | (-1, 1)       |   Yes   |    Yes    |       22       | Like tanh but computationally cheaper           |
| HARD_TANH       | [-1, 1]       |   Yes   |    Yes    |       21       | Clipped linear (alias: CLIPPED)                 |
| BENT_IDENTITY   | (-inf, inf)   |   No    |    Yes    |       20       | Smooth, always-positive slope                   |
| SINE            | [-1, 1]       |   Yes   |    No     |       16       | Periodic oscillating function                   |
| Cosine          | [-1, 1]       |   Yes   |    No     |       15       | Periodic, phase-shifted sine                    |
| ABSOLUTE        | [0, inf)      |   No    |    No     |       14       | Outputs absolute value of input                 |
| Cube            | (-inf, inf)   |   No    |    Yes    |       13       | Cubic transformation                            |
| ISRU            | (-1, 1)       |   Yes   |    Yes    |       12       | Inverse square root unit                        |
| LogSigmoid      | (-inf, 0)     |   No    |    Yes    |       11       | Logarithm of the sigmoid function               |
| GAUSSIAN        | (0, 1]        |   Yes   |    No     |       10       | Bell curve centred at zero                      |
| ReLU            | [0, inf)      |   No    |    Yes    |       5        | Rectified linear unit (alias: RELU)             |
| ReLU6           | [0, 6]        |   Yes   |    Yes    |       3        | ReLU capped at 6                                |
| TAN             | (-inf, inf)   |   No    |    Yes    |       2        | Tangent function (has asymptotes)               |
| Exponential     | (0, inf)      |   No    |    Yes    |       2        | Exponential growth/decay                        |
| STEP            | {0, 1}        |   Yes   |    Yes    |       2        | Binary step function                            |
| IDENTITY        | (-inf, inf)   |   No    |    Yes    |       1        | Passes input through unchanged                  |
| COMPLEMENT      | (-inf, inf)   |   No    |    Yes    |       1        | Returns 1 minus input (alias: INVERSE)          |
| StdInverse      | (-inf, inf)   |   No    |    No     |       1        | Returns 1 divided by input                      |
| BIPOLAR_SIGMOID | (-1, 1)       |   Yes   |    Yes    |       1        | Sigmoid scaled to (-1, 1)                       |
| BIPOLAR         | {-1, 1}       |   Yes   |    Yes    |       1        | Binary: outputs -1 or 1                         |
| SQRT            | [0, inf)      |   No    |    Yes    |       1        | Square root (zero for negative inputs)          |
| SQUARE          | [0, inf)      |   No    |    No     |       1        | Squares the input                               |

### Aggregate Functions

These functions operate on multiple inputs simultaneously, unlike standard
activation functions that transform a single value.

| Name    | Output Range | Mutation Prob. | Summary                                                     |
| :------ | :----------- | :------------: | :---------------------------------------------------------- |
| IF      | Varies       |       1        | Conditional: outputs one of two values based on a condition |
| MAXIMUM | (-inf, inf)  |       1        | Outputs the largest input value plus bias                   |
| MINIMUM | (-inf, inf)  |       1        | Outputs the smallest input value plus bias                  |

### Deprecated Functions

These functions have a mutation probability of **0**, meaning NEAT will never
select them for new neurons. They remain available for backward compatibility
with existing trained models.

| Name    | Output Range | Replacement                | Why Deprecated                                      |
| :------ | :----------- | :------------------------- | :-------------------------------------------------- |
| HYPOT   | (-inf, inf)  | Standard activation + bias | Expensive, unpredictable behaviour as a squash      |
| HYPOTv2 | [0, inf)     | Standard activation + bias | Same issues as HYPOT                                |
| MEAN    | (-inf, inf)  | Normal neuron with weights | A standard neuron can replicate averaging behaviour |

---

## Categories

### By Output Range

#### Bounded Functions (Fixed Output Range)

These functions constrain their output to a known range, which can be useful for
output layers where you need values in a specific interval.

**Range [0, 1] or (0, 1):**

- **LOGISTIC** — Classic sigmoid, most common for binary classification outputs
- **GAUSSIAN** — Bell-curve shape, useful when peak activation matters
- **STEP** — Hard binary output, no gradient (cannot learn via backpropagation)

**Range [-1, 1] or (-1, 1):**

- **TANH** — Most popular bounded activation for hidden layers
- **HARD_TANH** — Computationally cheaper linear approximation of TANH
- **SOFTSIGN** — Similar shape to TANH but approaches bounds more slowly
- **ISRU** — Inverse square root unit, smooth and bounded
- **BIPOLAR_SIGMOID** — Sigmoid rescaled to (-1, 1)
- **SINE** — Periodic, oscillates between -1 and 1
- **Cosine** — Periodic, phase-shifted version of SINE

**Range [0, 6]:**

- **ReLU6** — ReLU with an upper cap, used in mobile/embedded networks

**Other bounded:**

- **ArcTan** — Output in (-pi/2, pi/2), approximately (-1.57, 1.57)
- **BIPOLAR** — Hard binary, outputs exactly -1 or 1

#### Unbounded Functions (No Output Limit)

These functions can produce arbitrarily large (or small) outputs.

**Non-negative outputs [0, inf):**

- **ReLU** — Zero for negative inputs, linear for positive
- **ABSOLUTE** — Always non-negative
- **SQRT** — Square root of non-negative inputs
- **SQUARE** — Always non-negative (input squared)
- **Exponential** — Always positive, grows rapidly

**Full range (-inf, inf):**

- **LeakyReLU** — Like ReLU but with a small slope for negative inputs
- **GELU** — Smooth approximation of ReLU weighted by input probability
- **Swish** — Self-gated: x multiplied by sigmoid(x)
- **Mish** — Self-regularising: x multiplied by tanh(softplus(x))
- **ELU** — Smooth for negatives, linear for positives
- **SELU** — Self-normalising, maintains mean and variance
- **Softplus** — Smooth ReLU approximation (technically always positive)
- **BENT_IDENTITY** — Smooth curve, always has positive slope
- **IDENTITY** — No transformation
- **COMPLEMENT** — Returns 1 - x
- **Cube** — Cubic transformation
- **TAN** — Tangent (has periodic asymptotes)
- **LogSigmoid** — Always negative, approaches 0 from below
- **StdInverse** — Reciprocal of input

### By Differentiability

**Smooth and differentiable everywhere** (best for gradient-based learning):

- GELU, Swish, Mish, ELU, SELU, Softplus, TANH, LOGISTIC, ArcTan, SOFTSIGN,
  BENT_IDENTITY, ISRU, LogSigmoid, BIPOLAR_SIGMOID, Exponential, GAUSSIAN, SINE,
  Cosine

**Differentiable except at specific points** (generally still fine):

- ReLU (not differentiable at x=0), LeakyReLU (at x=0), HARD_TANH (at -1 and 1),
  ReLU6 (at 0 and 6), ABSOLUTE (at 0), COMPLEMENT, IDENTITY

**Not differentiable / zero derivative** (limited or no gradient-based
learning):

- STEP (derivative is zero everywhere except at x=0), BIPOLAR (same issue)

---

## Selection Guidance

### Output Layer Recommendations

The activation function for your output layer should match the type of problem
you are solving.

| Problem Type                       | Recommended Functions       | Why                                            |
| :--------------------------------- | :-------------------------- | :--------------------------------------------- |
| Binary classification (yes/no)     | LOGISTIC                    | Output in (0, 1), interpretable as probability |
| Multi-class classification         | LOGISTIC (per output)       | Each output represents a class probability     |
| Regression (any real number)       | IDENTITY, LeakyReLU         | Unbounded output matches continuous targets    |
| Regression (positive values only)  | ReLU, Softplus, Exponential | Constrained to non-negative outputs            |
| Regression (bounded, e.g., 0 to 1) | LOGISTIC                    | Natural bounded output                         |
| Regression (bounded, -1 to 1)      | TANH                        | Symmetric bounded output                       |
| Time series / sequence prediction  | IDENTITY, TANH              | Depends on target range                        |

### Hidden Layer Recommendations

For hidden layers, the goal is to maintain healthy gradient flow throughout the
network while introducing useful non-linearity.

**Top tier — recommended for most use cases:**

| Function  | Strengths                                                      |
| :-------- | :------------------------------------------------------------- |
| LeakyReLU | Fast, avoids dead neurons, works well in evolved topologies    |
| GELU      | Smooth, strong empirical performance, good gradient properties |
| Swish     | Self-gated, smooth, works well in deeper networks              |
| ELU       | Smooth for negatives, avoids dead neurons                      |
| SELU      | Self-normalising, maintains stable activations across layers   |
| Mish      | Self-regularising, smooth, strong in practice                  |

**Second tier — good alternatives:**

| Function      | Best When                                                   |
| :------------ | :---------------------------------------------------------- |
| TANH          | You need bounded outputs in hidden layers                   |
| Softplus      | You want a smooth ReLU-like function                        |
| ArcTan        | You need bounded outputs with guaranteed non-zero gradients |
| SOFTSIGN      | Cheaper alternative to TANH                                 |
| HARD_TANH     | Very fast, acceptable when precision is less important      |
| BENT_IDENTITY | You want a near-linear function with slight non-linearity   |
| LOGISTIC      | You need (0, 1) bounded hidden activations                  |

**Specialised — use with specific knowledge:**

| Function      | Use Case                                                    |
| :------------ | :---------------------------------------------------------- |
| SINE / Cosine | Periodic patterns (e.g., seasonal data, cyclic phenomena)   |
| GAUSSIAN      | Radial basis-like behaviour, peak responses                 |
| ABSOLUTE      | Magnitude detection, symmetric response                     |
| Cube          | When cubic non-linearity is specifically needed             |
| ISRU          | Bounded alternative to TANH with different gradient profile |
| LogSigmoid    | When log-probability outputs are needed in hidden layers    |

**Low priority — rarely needed:**

| Function       | Notes                                               |
| :------------- | :-------------------------------------------------- |
| ReLU           | Prone to dead neurons; prefer LeakyReLU or ELU      |
| STEP / BIPOLAR | No gradient — cannot learn via backpropagation      |
| IDENTITY       | No non-linearity, rarely useful in hidden layers    |
| COMPLEMENT     | Linear transformation, limited non-linearity        |
| StdInverse     | Unstable near zero, specialised use only            |
| TAN            | Has asymptotes that can cause numerical instability |
| Exponential    | Output grows rapidly, can cause overflow            |
| SQRT / SQUARE  | Limited applicability, can cause numerical issues   |

### Functions That Work Well with NEAT's Topology Evolution

NEAT evolves both the network's structure (topology) and its weights
simultaneously. Some activation functions are better suited to this evolutionary
process than others.

**Best for NEAT evolution:**

- **LeakyReLU, GELU, Swish, ELU, SELU, Mish** — These have high mutation
  probabilities (31-36), meaning NEAT's evolution naturally favours them. They
  provide smooth gradients that help memetic learning (the gradient-based
  fine-tuning that happens alongside evolution) while being robust enough to
  handle the varied topologies that NEAT generates.

- **TANH, LOGISTIC, Softplus** — Bounded functions that prevent activation
  values from exploding as NEAT adds new connections. Useful when the network
  grows and you want stable activations.

**Challenging for NEAT evolution:**

- **STEP, BIPOLAR** — These have zero gradients almost everywhere, which means
  memetic learning (backpropagation) cannot improve weights. Evolution must rely
  entirely on mutation and crossover, which is slower.

- **TAN, Exponential** — Can produce extreme values that destabilise the network
  when NEAT adds unexpected connections.

- **IDENTITY** — Provides no non-linearity, so NEAT cannot increase the
  network's expressiveness by adding neurons with this function.

---

## Intelligent Design Integration

**Intelligent Design** is NEAT-AI's automated system for optimising which
activation function each neuron uses. Instead of relying solely on random
mutation to find good activation functions, Intelligent Design methodically
tests alternatives and remembers what works.

### How It Works

1. **Scan phase**: For each hidden neuron, Intelligent Design temporarily
   replaces its activation function with a target function and scores the
   modified creature. If the score improves, the replacement is recorded.

2. **Alternative exploration**: When a neuron shows improvement with one
   function, the system automatically tries related functions from a curated
   tier list:
   - **Tier 1 (Core)**: GELU, Swish, LeakyReLU, Mish, SELU, ELU, TANH
   - **Tier 2 (Complementary)**: LOGISTIC, Softplus, ArcTan, SOFTSIGN,
     HARD_TANH, BENT_IDENTITY
   - **Tier 3 (Specialised)**: SINE, Cosine, ABSOLUTE, Cube, ISRU, LogSigmoid,
     GAUSSIAN

3. **Tacit knowledge**: Successful substitutions are stored as "tacit knowledge"
   — a mapping from neuron identity to optimal activation function. This
   knowledge can be reused across training runs and shared between machines.

### When to Use Intelligent Design vs Manual Selection

| Scenario                             | Approach                                                               |
| :----------------------------------- | :--------------------------------------------------------------------- |
| Starting a new project               | Let NEAT evolve freely, then run Intelligent Design to refine          |
| Optimising a mature model            | Use Intelligent Design to squeeze out improvements                     |
| You know the ideal output function   | Set output layer manually, let Intelligent Design handle hidden layers |
| Distributed training across machines | Share tacit knowledge via hive files for consistent optimisation       |
| Quick prototyping                    | Manual selection of top-tier functions (GELU, Swish, LeakyReLU)        |

### Example Usage

```typescript
import { scanForSquashImprovements } from "@stsoftware/neat-ai";

const result = await scanForSquashImprovements({
  creature: myCreature,
  targetSquash: "GELU",
  outputDir: "./improved",
  dataDir: "./training-data",
  bestScore: currentScore,
});

console.log(
  `Tested ${result.tested} neurons, found ${result.improved} improvements`,
);
```

For full details on the Intelligent Design API and workflow, see the
[Intelligent Design Guide](./INTELLIGENT_DESIGN.md).

---

## Aliases

Some activation functions have alternative names for convenience:

| Alias    | Actual Function |
| :------- | :-------------- |
| CLIPPED  | HARD_TANH       |
| RELU     | ReLU            |
| INVERSE  | COMPLEMENT      |
| SINUSOID | SINE            |

---

## Further Reading

- [Activation Function (Wikipedia)](https://en.wikipedia.org/wiki/Activation_function)
  — General background on activation functions in neural networks
- [Intelligent Design Guide](./INTELLIGENT_DESIGN.md) — Detailed guide to
  automated squash function optimisation
- [Backpropagation Elasticity](./BACKPROP_ELASTICITY.md) — How NEAT-AI handles
  weight updates near saturated activation functions
- [Activation Backpropagation Strategy](../src/methods/activations/README.md) —
  Technical details on derivative vs inversion-based error propagation
