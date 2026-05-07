# 🧠 Predictive Coding Architecture Design

> **Brief**: Architectural design and theoretical background for the optional
> Predictive Coding (PC) training mode. PC is a neuroscience-inspired
> alternative to standard backpropagation in which weight updates are **purely
> local** — each synapse is updated using only the prediction error at its
> target neuron and the activity at its source neuron. PC is **disabled by
> default**; enable it via `NeatOptions.predictiveCoding`.

## 📑 In this cluster

- **PREDICTIVE_CODING.md** (this file) — theory, architecture, and integration
  strategy.
- **[PREDICTIVE_CODING_BENCHMARKS.md](./PREDICTIVE_CODING_BENCHMARKS.md)** —
  benchmark numbers, validation results, and tuning findings backed by scripts
  in [`bench/predictiveCoding/`](../bench/predictiveCoding/).
- **[PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md)** — operational tuning
  knobs that govern memetic training (which PC slots into).
- **[PERFORMANCE_RESEARCH.md](./PERFORMANCE_RESEARCH.md)** — the wider
  optimisation pipeline that PC integrates with.

See the [docs index](./README.md) for the full topic map.

## 🧪 Acronyms used in this guide

- **PC** — Predictive Coding
- **NEAT** — NeuroEvolution of Augmenting Topologies
- **WASM** — WebAssembly
- **FFI** — Foreign Function Interface
- **MSE / MAE / RMSE / MAPE** — Mean Squared / Absolute / Root-Mean-Squared /
  Mean Absolute Percentage Error
- **MCMC** — Markov Chain Monte Carlo
- **GPU / CPU** — Graphics / Central Processing Unit
- **Hebbian** — "neurons that fire together, wire together" — a local learning
  rule that uses only pre- and post-synaptic activity

## 📖 Table of contents

1. [Background & Theory](#1--background--theory)
2. [Architecture Design](#2--architecture-design)
3. [Integration Strategy](#3--integration-strategy)
4. [Implementation Roadmap](#4--implementation-roadmap)
5. [Production Validation](#5--production-validation)
6. [Configuration Guide](#6--configuration-guide)
7. [Troubleshooting](#7--troubleshooting)
8. [References](#8--references)
9. [Further Reading](#-further-reading)

This document describes the architecture for integrating **Predictive Coding**
(PC) as an optional training mode in NEAT-AI. It serves as the blueprint for all
subsequent implementation work.

Part of [#1549](https://github.com/stSoftwareAU/NEAT-AI/issues/1549).

## 🔁 The predictive-coding loop at a glance

```mermaid
flowchart LR
    subgraph fast["Fast inner loop — settling (10–50 iters)"]
        I1[📥 Clamp inputs<br/>+ optional outputs] --> I2[⚡ Forward pass<br/>initial activity]
        I2 --> I3[📐 Predict each layer<br/>top-down]
        I3 --> I4[⚠️ Compute prediction<br/>errors ε]
        I4 --> I5[🔧 Update activities<br/>x ← x − η_x·∂L/∂x]
        I5 --> I6{Converged?}
        I6 -- "no" --> I3
    end
    I6 -- "yes" --> L1[📚 Hebbian weight update<br/>Δw = η_W·ε·f x ]
    L1 --> L2[💾 Store trace tags<br/>+ prediction errors]
    L2 --> next[➡️ Next training sample]
```

The same loop is described step-by-step in
[Section 2.4](#24--pc-inference-iterative-settling) and
[Section 2.5](#25--pc-learning-weight-updates), and benchmarked in
[PREDICTIVE_CODING_BENCHMARKS.md](./PREDICTIVE_CODING_BENCHMARKS.md).

---

## 1. 🔬 Background & Theory

### 🧩 What is Predictive Coding?

Predictive coding is a neuroscience-inspired learning framework in which every
layer of a hierarchical network maintains a **generative model** of the layer
below it. Each layer predicts the activity of the layer beneath, and only
**prediction errors** (the mismatch between prediction and actual activity)
propagate upward (Rao & Ballard, 1999).

In a standard feedforward network, information flows bottom-up. Predictive
coding adds a complementary **top-down prediction stream**: higher layers send
predictions downward, and lower layers send prediction errors upward. Learning
consists of adjusting weights to minimise these prediction errors across the
entire hierarchy.

> [!NOTE]
> Predictive coding originates from neuroscience (Rao & Ballard, 1999) and
> models how the brain may process sensory information. The key insight is that
> the brain continuously generates predictions about inputs and only propagates
> **errors** in those predictions — not the raw signal itself.

### ⚡ Core Energy Function

The objective that a PC network minimises is the **total prediction error
energy**:

\[ \mathcal{L} = \frac{1}{2} \sum_{l} \| \varepsilon^{(l)} \|^2 \]

where the prediction error at layer \(l\) is:

\[ \varepsilon^{(l)} = x^{(l)} - f\bigl(W^{(l)} \cdot x^{(l+1)}\bigr) \]

Here \(x^{(l)}\) is the activity at layer \(l\), \(W^{(l)}\) are the top-down
prediction weights, and \(f\) is a nonlinear activation function (squash in
NEAT-AI terminology).

### ⏱️ Two-Timescale Dynamics

PC operates on two distinct timescales (Bogacz, 2017):

1. **Fast inference (settling)** — Given fixed weights, neuron activities
   \(x^{(l)}\) are iteratively updated to minimise the energy \(\mathcal{L}\).
   This is an inner loop of gradient descent on the activities:

   \[ \Delta x^{(l)} = -\eta_x \frac{\partial \mathcal{L}}{\partial x^{(l)}} =
   -\eta_x \bigl( \varepsilon^{(l)} - (W^{(l-1)})^\top f'(\cdot) \cdot
   \varepsilon^{(l-1)} \bigr) \]

   The network "settles" into an equilibrium state where prediction errors are
   minimised. This typically takes 10–50 iterations for small networks
   (Salvatori et al., 2024).

2. **Slow learning (weight updates)** — Once the network has settled, weights
   are updated using the now-equilibrium prediction errors. The update rule is
   **local and Hebbian-like**:

   \[ \Delta W^{(l)} = \eta_W \cdot \varepsilon^{(l)} \cdot
   f\bigl(x^{(l+1)}\bigr)^\top \]

   Each synapse only needs information available at its pre- and post-synaptic
   neurons — no global error signal or weight transport is required (Whittington
   & Bogacz, 2017).

### 🔗 Local Learning vs Global Backpropagation

A key attraction of PC for NEAT-AI is that weight updates are **purely local**.
Each synapse update depends only on:

- The prediction error at its target neuron (\(\varepsilon^{(l)}\))
- The activity of its source neuron (\(f(x^{(l+1)})\))

This contrasts with standard backpropagation, which requires propagating
gradients through the entire network via the chain rule. Millidge, Tschantz &
Buckley (2022c) proved that PC converges to the same gradients as
backpropagation at equilibrium, making it a **biologically plausible
approximation** of backprop. Rosenbaum (2022) provides a complementary analysis
of the conditions under which PC and backprop produce equivalent updates.

This locality property maps naturally onto NEAT-AI's architecture, where each
`Neuron` already manages its own state and each `Synapse` connects exactly two
neurons.

> [!TIP]
> The locality of PC weight updates is a natural fit for NEAT-AI's per-neuron
> and per-synapse architecture. No global gradient signal is needed — each
> `Synapse` can compute its own update using only the prediction error at its
> target neuron and the activity of its source neuron.

### 🌐 Relationship to the Free Energy Principle

PC can be understood as a special case of the **free energy principle**
(Friston, 2018): the network minimises variational free energy, which
upper-bounds surprise (negative log-likelihood of observations). Under Gaussian
assumptions with fixed variance, free energy reduces to the sum-of-squared
prediction errors above (Bogacz, 2017). This connects NEAT-AI's PC extension to
a broader theoretical framework encompassing active inference and Bayesian brain
theories.

### 🔄 Relationship to Elastic Backpropagation

NEAT-AI's existing elastic backpropagation (see `docs/BACKPROP_ELASTICITY.md`)
already shares structural similarities with PC:

- Both compute a **target value** for each neuron and distribute error upstream.
- Both use **local information** (inbound synapse activations) to determine how
  error is allocated.
- Elastic backprop's safe-zone awareness parallels PC's natural handling of
  saturated neurons — prediction errors through saturated pathways are
  inherently small.

The key difference is that elastic backprop performs a **single pass** through
the network, while PC performs **iterative settling** before weight updates.
PC's iterative inference can potentially find better target activations for
hidden neurons, particularly in deep or recurrent topologies.

---

## 2. 🏗️ Architecture Design

### 2.1 🗺️ Mapping PC onto NEAT-AI's Existing Architecture

NEAT-AI's core architecture consists of:

| Component       | File                                | Role in PC                                                     |
| --------------- | ----------------------------------- | -------------------------------------------------------------- |
| `Creature`      | `src/Creature.ts`                   | The network as a whole; orchestrates PC inference and learning |
| `Neuron`        | `src/architecture/Neuron.ts`        | Holds prediction and error state per node                      |
| `Synapse`       | `src/architecture/Synapse.ts`       | Carries both feedforward activation and top-down predictions   |
| `CreatureState` | `src/architecture/CreatureState.ts` | Extended with PC-specific per-neuron buffers                   |
| `NeuronState`   | `src/architecture/CreatureState.ts` | Extended with prediction error and target fields               |

#### 🔢 How Layers Map

NEAT networks are not strictly layered — they are arbitrary directed graphs
(with optional recurrent connections). For PC, we define a neuron's **depth** as
its topological distance from the input layer:

- **Input neurons** (depth 0): Clamped to observed data. Their prediction error
  is the difference between the observation and the top-down prediction from
  depth-1 neurons.
- **Hidden neurons** (depth 1..N): Both predict the layer below and receive
  predictions from the layer above. They maintain both a **value node** (current
  activity) and an associated **error node** (prediction error).
- **Output neurons** (maximum depth): Clamped to target values during supervised
  training. Their prediction error drives the top of the hierarchy.

In NEAT-AI's variable-topology networks, depth is computed during
`Creature.prepare()` using topological sorting (already performed for
feedforward activation ordering).

### 2.2 🧮 Prediction Nodes vs Error Nodes

**Decision: Extend existing neurons with additional state rather than creating
new node types.**

Rationale:

1. NEAT-AI's mutation operators (`AddNeuron`, `SubNeuron`, `AddConnection`,
   etc.) operate on the existing `Neuron` and `Synapse` types. Introducing new
   node types would require modifying every mutation operator, the breeding
   system, serialisation, and WASM compilation — a massive and error-prone
   change.

2. The literature supports this approach: Millidge et al. (2022a) show that PC
   can be implemented with a single set of neurons where each neuron maintains
   both its current activity and its prediction error as separate state
   variables.

3. `NeuronState` in `src/architecture/CreatureState.ts` already carries
   per-neuron training metadata (`hintValue`, `totalErrorAbsolute`, etc.).
   Adding PC fields here is natural and non-breaking.

**New fields on `NeuronState`** (when PC is enabled):

```typescript
// In CreatureState.ts — NeuronState extension
pcPrediction?: number;       // Top-down prediction for this neuron
pcError?: number;            // Prediction error: activation - prediction
pcTargetActivity?: number;   // Settled activity after inference
```

**New fields on `SynapseState`** (when PC is enabled):

```typescript
// In CreatureState.ts — SynapseState extension
pcPredictionWeight?: number; // Top-down prediction weight (may differ from
                             // feedforward weight, or may be shared)
```

### 2.3 ⚖️ Weight Symmetry Decision

**Decision: Use shared (symmetric) weights for the initial implementation.**

In classical PC, feedforward weights \(W_{ff}\) and feedback prediction weights
\(W_{fb}\) are separate. However:

- Millidge et al. (2020) showed that **relaxing weight symmetry constraints**
  still yields effective learning.
- Whittington & Bogacz (2017) demonstrated that with tied weights (\(W_{fb} =
  W_{ff}^\top\)), PC approximates backpropagation.
- Using shared weights halves memory requirements and avoids the need to
  evolve/train a separate set of prediction weights.

For the initial implementation, the top-down prediction from neuron \(j\) to
neuron \(i\) uses the **transpose** of the existing feedforward synapse weight.
A future phase may introduce separate prediction weights if experiments show
benefit.

> [!NOTE]
> Using symmetric (shared) weights between feedforward and feedback paths halves
> memory requirements and is theoretically grounded — Whittington & Bogacz
> (2017) showed that tied weights cause PC to approximate backpropagation. This
> is the chosen starting point; separate prediction weights may be explored in a
> future phase.

### 2.4 🔄 PC Inference (Iterative Settling)

The inference loop runs **before** weight updates, for each training sample:

```mermaid
flowchart TD
    classDef input fill:#3498db,stroke:#2980b9,color:#fff
    classDef process fill:#2ecc71,stroke:#27ae60,color:#fff
    classDef decision fill:#f39c12,stroke:#e67e22,color:#fff
    classDef output fill:#9b59b6,stroke:#8e44ad,color:#fff
    classDef compute fill:#1abc9c,stroke:#16a085,color:#fff

    A["📥 Clamp input neurons\nto inputData"]:::input
    B["⚡ Run one feedforward pass\nto initialise hidden/output\nactivations"]:::process
    C{"Supervised\ntraining?"}:::decision
    D["🎯 Clamp output neurons\nto targetData"]:::process
    E["🔄 For each hidden neuron\n(reverse depth order)"]:::compute
    F["📐 Compute top-down prediction:\npred_i = f(Σ_j w_ji · x_j)"]:::compute
    G["⚠️ Compute prediction error:\nε_i = x_i - pred_i"]:::compute
    H["🔧 Update activity:\nx_i ← x_i - η_x · (ε_i - Σ_k w_ik · f' · ε_k)"]:::compute
    I["📊 Compute total energy:\nE = ½ Σ ‖ε_i‖²"]:::process
    J{"Converged?\n|E_prev - E| <\nthreshold"}:::decision
    K{"iteration <\nmaxIterations?"}:::decision
    L["💾 Store settled activities\nand prediction errors\nin NeuronState"]:::output

    A --> B --> C
    C -- "YES" --> D --> E
    C -- "NO" --> E
    E --> F --> G --> H --> I --> J
    J -- "YES" --> L
    J -- "NO" --> K
    K -- "YES" --> E
    K -- "NO" --> L
```

This integrates with the existing forward activation path:

- Step 2 reuses `Creature.activate()` (or WASM `CompiledNetwork.activate()`) for
  the initial forward pass.
- Steps 4a–4c are new PC-specific computation — the hot inner loop targeted for
  WASM/Rust implementation.
- Step 5 stores results in the existing `CreatureState` structure.

### 2.5 📚 PC Learning (Weight Updates)

After inference has settled, weights are updated using the local Hebbian rule:

```mermaid
flowchart LR
    classDef synapse fill:#3498db,stroke:#2980b9,color:#fff
    classDef neuron fill:#2ecc71,stroke:#27ae60,color:#fff

    S["⚡ For each synapse (i → j):\nΔw_ij = η_W · ε_j · f(x_i)"]:::synapse
    N["🧠 For each neuron j:\nΔb_j = η_W · ε_j"]:::neuron

    S --> N
```

This replaces or complements the elastic backpropagation step
(`Neuron.propagate()`) when PC mode is active. The existing
`Neuron.propagateUpdate()` mechanism for applying accumulated weight/bias
changes can be reused — the only difference is **how** the deltas are computed.

### 2.6 🔌 Integration with Existing Forward Activation

The activation pipeline remains unchanged when PC is disabled:

```mermaid
flowchart LR
    classDef standard fill:#3498db,stroke:#2980b9,color:#fff
    classDef pc fill:#2ecc71,stroke:#27ae60,color:#fff
    classDef output fill:#9b59b6,stroke:#8e44ad,color:#fff

    subgraph current["Current Pipeline"]
        A1["🔢 Input"]:::standard
        A2["⚡ activate()"]:::standard
        A3["📊 Output"]:::standard
        A4["🎯 Score"]:::standard
        A1 --> A2 --> A3 --> A4
    end

    subgraph withPC["With Predictive Coding"]
        B1["🔢 Input"]:::standard
        B2["⚡ activate()"]:::standard
        B3["🧠 PC Settle"]:::pc
        B4["📊 Output"]:::standard
        B5["🎯 Score"]:::standard
        B6["📐 Weight Update\n(local Hebbian)"]:::pc
        B1 --> B2 --> B3 --> B4 --> B5
        B3 --> B6
    end

    style current fill:#f0f4ff,stroke:#2980b9,color:#333
    style withPC fill:#f0fff4,stroke:#27ae60,color:#333
```

PC settling occurs **between** the initial activation and scoring. The settled
activations become the "true" activations used for fitness evaluation.

### 2.7 ⚙️ TypeScript vs Rust/WASM Decision

| Component                          | Language                 | Rationale                                                                           |
| ---------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| PC configuration and orchestration | TypeScript               | Follows existing config patterns; called once per training step                     |
| PC inference inner loop (settling) | Rust/WASM                | Hot loop (10–50 iterations per sample); benefits from SIMD and compiled performance |
| PC weight update computation       | Rust/WASM                | Runs per-synapse per-sample; benefits from batch processing                         |
| PC-enhanced structural discovery   | Rust (NEAT-AI-Discovery) | Prediction errors provide richer signals for the existing GPU-accelerated analysis  |
| Integration tests and validation   | TypeScript (Deno)        | Follows existing test patterns                                                      |

The Rust/WASM components extend the existing `wasm_activation` crate
(`wasm_activation/src/`). New Rust modules:

- `wasm_activation/src/pc_inference.rs` — Settling loop with convergence
  detection
- `wasm_activation/src/pc_learning.rs` — Batch Hebbian weight updates

The TypeScript side calls these through the existing WASM bridge pattern
(`src/wasm/`), adding new wrapper functions in a `PredictiveCodingWasm.ts`
module.

> [!WARNING]
> The PC inference inner loop is the critical performance bottleneck. For large
> networks (90+ neurons), each settling step is O(N + S) and with up to 50
> iterations this is up to 50x the cost of a single forward pass. The Rust/WASM
> implementation is essential for production use — the TypeScript prototype
> should only be used for testing and validation on small networks.

---

## 3. 🔧 Integration Strategy

### 3.1 🔒 PC as an Optional Training Mode

**Principle: PC is strictly opt-in. When disabled (the default), all existing
behaviour is unchanged.**

The existing training pipeline:

```
evolveDir() → NEAT.evolve() → per generation:
  1. Fitness evaluation (WASM activation)
  2. Backprop training (propagate → propagateUpdate)
  3. Memetic fine-tuning (FineTune.ts)
  4. Breeding (crossover + mutation)
  5. Discovery (Error-Guided Structural Evolution)
  6. Species management
```

With PC enabled, step 2 is augmented:

```
2. Training:
   a. PC inference settling (new — iterative inner loop)
   b. PC weight update (replaces elastic backprop OR runs alongside it)
   c. Existing propagateUpdate() applies accumulated changes
```

Steps 1, 3, 4, 5, and 6 remain entirely unchanged. The creature's fitness is
still evaluated using standard WASM activation — PC only affects how weight
updates are computed during training.

### 3.2 🛠️ Configuration Design

Following the established config pattern (see `src/config/` for examples like
`BiasRegularisationConfig.ts`):

**File: `src/config/PredictiveCodingConfig.ts`**

```typescript
/**
 * Configuration for Predictive Coding training mode.
 *
 * When enabled, training uses iterative inference (settling) followed by
 * local Hebbian weight updates instead of (or alongside) elastic
 * backpropagation.
 */
export interface PredictiveCodingConfig {
  /** Whether PC training is enabled. Default: false */
  enabled?: boolean;

  /** Maximum iterations for inference settling. Default: 20 */
  maxInferenceIterations?: number;

  /** Convergence threshold for early stopping during settling.
   *  Settling stops when |E_prev - E_current| < threshold. Default: 1e-4 */
  convergenceThreshold?: number;

  /** Learning rate for activity updates during inference. Default: 0.1 */
  inferenceRate?: number;

  /** Learning rate for weight updates after settling. Default: 0.01 */
  learningRate?: number;

  /** Strategy for combining PC with existing backprop.
   *  - "replace": PC replaces elastic backprop entirely
   *  - "complement": PC runs first, then elastic backprop refines
   *  Default: "replace" */
  integrationMode?: "replace" | "complement";
}

export type RequiredPredictiveCodingConfig = Required<PredictiveCodingConfig>;

export const DEFAULT_PREDICTIVE_CODING_CONFIG: RequiredPredictiveCodingConfig =
  {
    enabled: false,
    maxInferenceIterations: 20,
    convergenceThreshold: 1e-4,
    inferenceRate: 0.1,
    learningRate: 0.01,
    integrationMode: "replace",
  };
```

**Integration points** (following the config pattern from `MEMORY.md`):

1. Add `predictiveCoding: RequiredPredictiveCodingConfig` to
   `src/config/NeatArguments.ts`
2. Add partial override to `src/config/NeatOptions.ts` (both `NeatOptions` and
   `NeatOptionsInput` types, with `CoerceNumeric<>` for CLI numeric fields)
3. Add to both `Omit` lists in `NeatOptions.ts`
4. Parse in `src/config/NeatConfig.ts` using `parseNumber()` with IIFE pattern
5. Cross-field validation (e.g., `inferenceRate` must be positive) goes after
   config object creation, before `validate()`

### 3.3 ✅ Backward Compatibility Guarantees

- **Default off**: `DEFAULT_PREDICTIVE_CODING_CONFIG.enabled = false` ensures no
  existing behaviour changes unless explicitly opted in.
- **Serialisation**: PC state fields on `NeuronState` and `SynapseState` are
  optional (`?` typed). Creatures serialised without PC can be loaded and
  trained with PC, and vice versa.
- **WASM**: New Rust modules are additive — the existing `CompiledNetwork`
  interface is unchanged. PC functionality is exposed through new WASM
  functions.
- **All existing tests must pass**: Every PR in the implementation roadmap must
  pass the full test suite (2000+ tests) without modification to existing tests.

### 3.4 🔍 How PC Prediction Errors Enhance Structural Evolution

NEAT-AI's Discovery system (`src/architecture/ErrorGuidedStructuralEvolution/`)
uses per-neuron error signals to propose structural mutations. PC provides
**richer error information** than standard backprop:

1. **Per-neuron prediction errors** reveal which neurons are poorly predicted by
   their parents — candidates for `AddConnection` mutations to provide
   additional predictive input.

2. **Settling dynamics** reveal which neurons take longest to converge —
   candidates for `AddNeuron` mutations to provide intermediate representations.

3. **Residual prediction errors** after settling indicate fundamental model
   limitations — candidates for architectural changes (new squash functions via
   `ModSquash`, or topology changes).

These signals feed into the existing `RustDiscovery.ts` interface. The Rust
discovery library (`NEAT-AI-Discovery`) receives the enriched error data through
its existing JSON-based `record_discovery()` FFI call, extended with PC-specific
fields.

---

## 4. 🗓️ Implementation Roadmap

### 🧱 Phase 1: Configuration and State Infrastructure

**Goal**: Add PC configuration and extend creature state without changing any
runtime behaviour.

- Create `PredictiveCodingConfig.ts` following the config pattern
- Wire into `NeatArguments.ts`, `NeatOptions.ts`, `NeatConfig.ts`
- Add optional PC fields to `NeuronState` and `SynapseState` in
  `CreatureState.ts`
- Add depth computation utility (topological distance from inputs)
- Write comprehensive unit tests for config parsing and validation
- **Result**: All existing tests pass; PC config is parseable but has no effect

**Key files**:

- `src/config/PredictiveCodingConfig.ts` (new)
- `src/config/NeatArguments.ts` (modified)
- `src/config/NeatOptions.ts` (modified)
- `src/config/NeatConfig.ts` (modified)
- `src/architecture/CreatureState.ts` (modified)

### 🔬 Phase 2: TypeScript PC Inference Prototype

**Goal**: Implement PC inference (settling) in TypeScript as a working
prototype.

- Implement the settling algorithm in a new `src/propagate/PredictiveCoding.ts`
  module
- Integrate with `CreatureTraining.ts` — call settling before weight updates
  when `pc.enabled === true`
- Implement Hebbian weight update rule
- Write tests verifying convergence on simple networks (XOR, AND, OR)
- Benchmark inference loop to establish baseline for WASM optimisation
- **Depends on**: Phase 1
- **Result**: PC training works end-to-end in TypeScript; performance baseline
  established

**Key files**:

- `src/propagate/PredictiveCoding.ts` (new)
- `src/creature/CreatureTraining.ts` (modified)

### ⚡ Phase 3: Rust/WASM PC Inference

**Goal**: Port the PC inference hot loop to Rust/WASM for production
performance.

- Add `pc_inference.rs` and `pc_learning.rs` to `wasm_activation/src/`
- Expose WASM functions: `pc_settle()`, `pc_weight_update()`
- Add TypeScript WASM wrapper `src/wasm/PredictiveCodingWasm.ts`
- Benchmark against TypeScript prototype — target 5–10x speedup
- Replace TypeScript inference with WASM calls (keep TypeScript as fallback)
- **Depends on**: Phase 2
- **Result**: PC training at production speed via WASM

**Key files**:

- `wasm_activation/src/pc_inference.rs` (new)
- `wasm_activation/src/pc_learning.rs` (new)
- `wasm_activation/src/lib.rs` (modified — re-export new modules)
- `src/wasm/PredictiveCodingWasm.ts` (new)

### 🔍 Phase 4: Discovery Integration

**Goal**: Feed PC prediction errors into the structural evolution pipeline.

- Extend `Creature.record()` to capture PC prediction errors when available
- Extend the discovery JSON format to include PC-specific error signals
- Update `NEAT-AI-Discovery` (separate repo) to consume PC error fields
- Add PC-informed structural candidate scoring
- **Depends on**: Phase 3
- **Result**: PC errors guide structural evolution for better topology discovery

**Key files**:

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`
  (modified)
- `src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts` (modified)
- NEAT-AI-Discovery repo (separate PRs)

### 🚀 Phase 5: Complement Mode and Advanced Features

**Goal**: Enable PC and elastic backprop to work together, and add adaptive
settling.

- Implement `integrationMode: "complement"` — PC settling followed by elastic
  backprop refinement
- Adaptive inference iterations (fewer iterations when prediction errors are
  already small)
- PC-aware memetic evolution (use PC prediction errors to guide fine-tuning in
  `FineTune.ts`)
- Performance tuning and documentation
- **Depends on**: Phase 4
- **Result**: Full PC integration with all NEAT-AI training modes

### 📊 Dependency Graph

```mermaid
flowchart TD
    classDef phase fill:#3498db,stroke:#2980b9,color:#fff

    P1["🧱 Phase 1\nConfig & State"]:::phase
    P2["🔬 Phase 2\nTypeScript Prototype"]:::phase
    P3["⚡ Phase 3\nRust/WASM"]:::phase
    P4["🔍 Phase 4\nDiscovery Integration"]:::phase
    P5["🚀 Phase 5\nComplement Mode & Advanced"]:::phase

    P1 --> P2 --> P3 --> P4 --> P5
```

Each phase produces a working, tested PR. Phases are strictly sequential — each
depends on the previous one being merged and passing all tests.

### ⚡ Performance Considerations

The PC inference loop is the critical performance bottleneck:

- **Per-sample cost**: For a network with \(N\) neurons, each settling iteration
  is \(O(N + S)\) where \(S\) is the number of synapses. With 20 iterations,
  this is 20x the cost of a single forward pass.
- **Why WASM**: The settling loop involves tight numerical computation
  (multiply-accumulate, activation function evaluation) that benefits enormously
  from compiled Rust + SIMD. The existing WASM activation already demonstrates
  10–50x speedup over TypeScript for similar operations.
- **Batch processing**: Multiple training samples can share the same compiled
  network structure, amortising WASM compilation overhead via the existing
  `WasmCompilationCache` (`src/wasm/WasmCompilationCache.ts`).
- **Early convergence**: The convergence threshold allows settling to stop early
  when prediction errors are already small, avoiding unnecessary iterations.

> [!TIP]
> Early convergence detection is an important optimisation. When prediction
> errors are already small (e.g., after weight updates stabilise), the settling
> loop can terminate well before `maxInferenceIterations` — reducing per-sample
> cost significantly. Tuning `convergenceThreshold` is worthwhile when
> optimising for throughput.

### 🔧 Adaptive Scaling for Complex Creatures (Issue #1915)

Default PC configuration values are tuned for small networks (~5-10 hidden
neurons). On complex creatures with 30-90+ hidden neurons, three issues prevent
convergence:

1. **Energy threshold too tight**: Total energy `E = ½ Σ ε²` sums over all
   non-input neurons. With 90+ error terms, the default threshold `1e-6` is
   unreachable — inference exhausts all steps without converging.
2. **Inference rate not scaled for connectivity**: Large gradient sums from many
   downstream neurons cause oscillation or divergence at the default `0.05`
   rate.
3. **Learning rate too conservative**: The default `0.001` produces
   imperceptible weight changes when spread across many parameters.

The adaptive scaling module (`src/predictiveCoding/AdaptiveScaling.ts`)
automatically adjusts these parameters based on network topology:

| Parameter         | Scaling                  | Rationale                                              |
| ----------------- | ------------------------ | ------------------------------------------------------ |
| `inferenceRate`   | `÷ √(hiddenCount / 10)`  | Prevents oscillation from large gradient sums          |
| `energyThreshold` | `× (nonInputCount / 10)` | Makes convergence achievable with more error terms     |
| `learningRate`    | `× √(hiddenCount / 10)`  | Keeps weight updates meaningful across many parameters |

Scaling is only applied when the network has more than 10 hidden neurons. For
small networks, the configured values are used as-is.

Additionally, inference gradients are normalised by their L2 norm (capped at
1.0) to prevent divergence in deep topologies where gradient magnitudes can
explode.

> [!TIP]
> With adaptive scaling, the default PC configuration works well on creatures
> with 30-90+ hidden neurons without manual tuning. If you need finer control,
> the explicit configuration values are scaled relative to the defaults, so
> setting `inferenceRate: 0.1` on a 40-neuron creature will produce an effective
> rate of approximately `0.1 / √4 = 0.05`.

---

## 5. ✅ Production Validation

Once Predictive Coding is enabled in your training pipeline, you can verify that
it is active and working by inspecting the **trace tags** attached to training
outputs. These tags were introduced in Issue #1913.

### 🏷️ Trace Tags

When PC training runs, the following tags are added to both the `trace` and
`compact` exports:

| Tag                  | Type   | Meaning                                                                 |
| -------------------- | ------ | ----------------------------------------------------------------------- |
| `approach`           | string | Set to `"predictive-coding"` when PC was used for training              |
| `pc-energy`          | string | Average total prediction error energy at convergence across all samples |
| `pc-inference-steps` | string | Average number of inference settling steps used per sample              |
| `pc-changed`         | string | Whether weights were modified during training (`"true"` or `"false"`)   |

**How to verify PC is active:**

1. Enable PC in your training configuration:
   ```typescript
   const options = {
     predictiveCoding: { enabled: true },
     // ... other options
   };
   ```

2. After training completes, inspect the trace output for the `approach` tag:
   ```typescript
   import { getTag } from "@stsoftware/tags/mod";

   const approach = getTag(trace, "approach");
   // Should be "predictive-coding" if PC was used
   ```

3. Check the energy and inference steps to confirm settling occurred:
   ```typescript
   const energy = parseFloat(getTag(trace, "pc-energy") ?? "NaN");
   const steps = parseFloat(getTag(trace, "pc-inference-steps") ?? "NaN");
   // energy should be a small positive number
   // steps should be between 1 and inferenceSteps (default: 50)
   ```

> [!TIP]
> If `approach` is absent or not `"predictive-coding"`, PC did not run. Check
> that `predictiveCoding.enabled` is `true` in your configuration. Standard
> backpropagation does not add any PC-specific tags.

### 🔍 Interpreting Tag Values

- **`pc-energy` is high (> 1.0)**: The network may need more inference steps or
  a lower `energyThreshold`. For complex creatures (30+ neurons), adaptive
  scaling handles this automatically — see the Configuration Guide below.

- **`pc-inference-steps` equals `inferenceSteps`**: Inference did not converge
  before the step limit. Consider increasing `inferenceSteps` or relaxing
  `energyThreshold`. For complex creatures, adaptive scaling adjusts the
  threshold automatically.

- **`pc-changed` is `"false"`**: No weights were updated. This can happen if
  prediction errors are already minimal or the `learningRate` is too low.

---

## 6. ⚙️ Configuration Guide

### 🔧 Configuration Parameters

| Parameter         | Default | Description                                             |
| ----------------- | ------- | ------------------------------------------------------- |
| `enabled`         | `false` | Whether PC training mode is active                      |
| `inferenceSteps`  | `50`    | Maximum settling iterations per sample                  |
| `inferenceRate`   | `0.05`  | Learning rate for inference (activity) updates          |
| `learningRate`    | `0.001` | Learning rate for Hebbian weight updates                |
| `energyThreshold` | `1e-6`  | Convergence threshold for total prediction error energy |

### 📏 Recommended Settings by Network Size

The default configuration is tuned for small networks. For larger networks,
**adaptive scaling** (Issue #1915) automatically adjusts parameters based on
network topology. You can use the defaults and rely on adaptive scaling, or
manually tune for specific use cases.

#### Small Networks (< 10 hidden neurons)

Use the defaults — no tuning required:

```typescript
const options = {
  predictiveCoding: { enabled: true },
};
```

Adaptive scaling does not activate for networks at or below 10 hidden neurons.

#### Medium Networks (10–50 hidden neurons)

Adaptive scaling activates automatically. The effective parameters are:

| Parameter         | Effective Value                     | Example (30 hidden) |
| ----------------- | ----------------------------------- | ------------------- |
| `inferenceRate`   | `configured ÷ √(hiddenCount / 10)`  | ~0.029              |
| `energyThreshold` | `configured × (nonInputCount / 10)` | ~4e-6               |
| `learningRate`    | `configured × √(hiddenCount / 10)`  | ~0.0017             |

No manual configuration is typically needed. If you want finer control:

```typescript
const options = {
  predictiveCoding: {
    enabled: true,
    inferenceSteps: 50, // Default is usually sufficient
    inferenceRate: 0.05, // Will be scaled down automatically
    learningRate: 0.001, // Will be scaled up automatically
  },
};
```

#### Large Networks (50+ hidden neurons)

Adaptive scaling is essential for large networks. The scaling factors become
more pronounced:

| Parameter         | Example (80 hidden) |
| ----------------- | ------------------- |
| `inferenceRate`   | ~0.018              |
| `energyThreshold` | ~9e-6               |
| `learningRate`    | ~0.0028             |

For very large networks, you may also want to increase inference steps:

```typescript
const options = {
  predictiveCoding: {
    enabled: true,
    inferenceSteps: 80, // More steps for deeper hierarchies
  },
};
```

> [!NOTE]
> Adaptive scaling preserves the _relative_ meaning of your configured values.
> Setting `inferenceRate: 0.1` on a 40-neuron creature produces an effective
> rate of approximately `0.1 / √4 = 0.05`. The scaling ensures convergence
> without requiring per-topology manual tuning.

### 🔗 Relationship Between Parameters and Network Complexity

- **`inferenceRate` and connectivity**: Large gradient sums from many downstream
  neurons can cause oscillation at high inference rates. Adaptive scaling
  reduces the rate proportionally to `√(hiddenCount / 10)`.

- **`inferenceSteps` and depth**: Deeper hierarchies require more settling
  iterations for prediction errors to propagate across layers. Multi-layer
  networks may need 50–80 steps, while single-layer networks converge in 10–20.

- **`energyThreshold` and neuron count**: Total energy `E = ½ Σ ε²` sums over
  all non-input neurons. With more neurons, even small per-neuron errors
  accumulate to a high total. Adaptive scaling relaxes the threshold in
  proportion to `nonInputCount / 10`.

- **`learningRate` and parameter count**: Weight updates are distributed across
  all synapses. More synapses means each individual update has less impact.
  Adaptive scaling increases the rate proportionally to `√(hiddenCount / 10)`.

Additionally, inference gradients are normalised by their L2 norm (capped at
1.0) to prevent divergence in deep topologies where gradient magnitudes can
explode.

---

## 7. 🔧 Troubleshooting

### PC Shows No Improvement

If PC training produces no measurable improvement over standard backpropagation:

1. **Check that PC is actually running**: Verify the `approach` trace tag is
   `"predictive-coding"` (see Production Validation above).

2. **Check `pc-changed`**: If `"false"`, the Hebbian weight updates produced no
   changes. This may indicate:
   - `learningRate` is too low — try increasing it (e.g., `0.01`).
   - Prediction errors are already minimal — the network may already be
     well-trained.

3. **Check `pc-inference-steps`**: If it equals `inferenceSteps` (the maximum),
   inference is not converging. For complex creatures (30+ neurons), adaptive
   scaling should handle this. If not:
   - Increase `inferenceSteps` (e.g., `80` or `100`).
   - Relax `energyThreshold` (e.g., `1e-4`).

4. **Check network size**: For creatures with 30+ hidden neurons, ensure you are
   using the default configuration — adaptive scaling activates automatically.
   Overriding with manually tuned small-network values may prevent convergence.

5. **Check activation functions**: PC works best with smooth, differentiable
   activation functions (LOGISTIC, TANH). Step-like or discontinuous functions
   may produce poor prediction error gradients.

### PC is Slower Than Expected

- **Inference dominates cost**: The settling loop is the bottleneck, not
  gradient computation or weight updates. Reducing `inferenceSteps` is the most
  effective way to reduce per-sample training time.
- **Large networks**: For networks with 90+ neurons, each settling step is O(N +
  S). Consider the Rust/WASM inference engine for production workloads.

### Energy Does Not Decrease During Settling

- **Inference rate too high**: The rate may cause overshooting. Adaptive scaling
  should handle this for complex creatures, but if using manual values, try
  reducing `inferenceRate`.
- **Non-smooth activations**: Some activation functions may not produce
  well-behaved energy gradients. Prefer LOGISTIC or TANH for PC-trained neurons.

---

## 8. 📖 References

- Bogacz, R. (2017). A tutorial on the free-energy framework for modelling
  perception and learning. _Journal of Mathematical Psychology_, 76, 198–211.
  [doi:10.1016/j.jmp.2015.11.003](https://doi.org/10.1016/j.jmp.2015.11.003)

- Friston, K. (2018). Does predictive coding have a future? _Nature
  Neuroscience_, 21, 1019–1021.
  [doi:10.1038/s41593-018-0200-7](https://doi.org/10.1038/s41593-018-0200-7)

- Huang, Y. & Rao, R.P.N. (2011). Predictive coding. _WIREs Cognitive Science_,
  2, 580–593. [doi:10.1002/wcs.142](https://doi.org/10.1002/wcs.142)

- Keller, G.B. & Mrsic-Flogel, T.D. (2018). Predictive Processing: A Canonical
  Cortical Computation. _Neuron_, 100, 424–435.
  [doi:10.1016/j.neuron.2018.10.003](https://doi.org/10.1016/j.neuron.2018.10.003)

- Lillicrap, T.P., Santoro, A., Marris, L., Akerman, C.J. & Hinton, G. (2020).
  Backpropagation and the brain. _Nature Reviews Neuroscience_, 21, 335–346.
  [doi:10.1038/s41583-020-0277-3](https://doi.org/10.1038/s41583-020-0277-3)

- Marino, J. (2021). Predictive Coding, Variational Autoencoders, and Biological
  Connections.
  [doi:10.48550/arXiv.2011.07464](https://doi.org/10.48550/arXiv.2011.07464)

- Millidge, B., Salvatori, T., Song, Y., Bogacz, R. & Lukasiewicz, T. (2022a).
  Predictive Coding: Towards a Future of Deep Learning beyond Backpropagation?

- Millidge, B., Seth, A. & Buckley, C.L. (2022b). Predictive Coding: a
  Theoretical and Experimental Review.
  [doi:10.48550/arXiv.2107.12979](https://doi.org/10.48550/arXiv.2107.12979)

- Millidge, B., Song, Y., Salvatori, T., Lukasiewicz, T. & Bogacz, R. (2023). A
  Theoretical Framework for Inference and Learning in Predictive Coding
  Networks.

- Millidge, B., Tschantz, A. & Buckley, C.L. (2022c). Predictive Coding
  Approximates Backprop Along Arbitrary Computation Graphs. _Neural
  Computation_, 34, 1329–1368.
  [doi:10.1162/neco_a_01497](https://doi.org/10.1162/neco_a_01497)

- Millidge, B., Tschantz, A., Seth, A. & Buckley, C.L. (2020). Relaxing the
  Constraints on Predictive Coding Models.
  [doi:10.48550/arXiv.2010.01047](https://doi.org/10.48550/arXiv.2010.01047)

- Rao, R.P.N. & Ballard, D.H. (1999). Predictive coding in the visual cortex: a
  functional interpretation of some extra-classical receptive-field effects.
  _Nature Neuroscience_, 2, 79–87.
  [doi:10.1038/4580](https://doi.org/10.1038/4580)

- Rosenbaum, R. (2022). On the relationship between predictive coding and
  backpropagation. _PLoS ONE_, 17, e0266102.
  [doi:10.1371/journal.pone.0266102](https://doi.org/10.1371/journal.pone.0266102)

- Salvatori, T., Mali, A., Buckley, C.L., Lukasiewicz, T., Rao, R.P.N., Friston,
  K. & Ororbia, A. (2025). A Survey on Brain-Inspired Deep Learning via
  Predictive Coding.
  [doi:10.48550/arXiv.2308.07870](https://doi.org/10.48550/arXiv.2308.07870)

- Salvatori, T., Song, Y., Lukasiewicz, T., Bogacz, R. & Xu, Z. (2023). Reverse
  Differentiation via Predictive Coding.
  [doi:10.48550/arXiv.2103.04689](https://doi.org/10.48550/arXiv.2103.04689)

- Salvatori, T., Song, Y., Yordanov, Y., Millidge, B., Xu, Z., Sha, L., Emde,
  C., Bogacz, R. & Lukasiewicz, T. (2024). A Stable, Fast, and Fully Automatic
  Learning Algorithm for Predictive Coding Networks.
  [doi:10.48550/arXiv.2212.00720](https://doi.org/10.48550/arXiv.2212.00720)

- Song, Y., Lukasiewicz, T., Xu, Z. & Bogacz, R. (n.d.). Can the Brain Do
  Backpropagation? — Exact Implementation of Backpropagation in Predictive
  Coding Networks.

- Song, Y., Millidge, B., Salvatori, T., Lukasiewicz, T., Xu, Z. & Bogacz, R.
  (2024). Inferring neural activity before plasticity as a foundation for
  learning beyond backpropagation. _Nature Neuroscience_, 27, 348–358.
  [doi:10.1038/s41593-023-01514-1](https://doi.org/10.1038/s41593-023-01514-1)

- Whittington, J.C.R. & Bogacz, R. (2019). Theories of Error Back-Propagation in
  the Brain. _Trends in Cognitive Sciences_, 23, 235–250.
  [doi:10.1016/j.tics.2018.12.005](https://doi.org/10.1016/j.tics.2018.12.005)

- Whittington, J.C.R. & Bogacz, R. (2017). An Approximation of the Error
  Backpropagation Algorithm in a Predictive Coding Network with Local Hebbian
  Synaptic Plasticity. _Neural Computation_, 29, 1229–1262.
  [doi:10.1162/NECO_a_00949](https://doi.org/10.1162/NECO_a_00949)

---

## 📚 Further Reading

- [PREDICTIVE_CODING_BENCHMARKS.md](./PREDICTIVE_CODING_BENCHMARKS.md) —
  benchmark companion to this doc; numbers are produced by
  [`bench/predictiveCoding/`](../bench/predictiveCoding/).
- [PERFORMANCE_RESEARCH.md](./PERFORMANCE_RESEARCH.md) — wider performance
  optimisation log that frames where PC sits in the pipeline.
- [PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md) — operational tuning of the
  memetic training pipeline that PC plugs into.
- [BACKPROP_ELASTICITY.md](./BACKPROP_ELASTICITY.md) — elastic backpropagation,
  which shares structural similarities with PC.
- [CONFIGURATION_GUIDE.md](./CONFIGURATION_GUIDE.md) — every `NeatOptions`
  field, including the PC-specific options described in
  [Section 6](#6--configuration-guide).
- [DISCOVERY_GUIDE.md](./DISCOVERY_GUIDE.md) — error-guided structural
  evolution; PC produces compatible per-neuron error signals that discovery can
  consume.
- [docs/README.md](./README.md) — topic index for the full documentation set.
- Wikipedia:
  [Predictive coding](https://en.wikipedia.org/wiki/Predictive_coding)
- NEAT-AI-Discovery repository:
  [stSoftwareAU/NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)

---

**Up to:** [`README.md`](../README.md) (entry point) ·
[`docs/README.md`](README.md) (topic index).
