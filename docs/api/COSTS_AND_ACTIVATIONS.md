# 💰 Costs and Activations

Cost (fitness) functions and the activation function (squash) menu used by NEAT
(NeuroEvolution of Augmenting Topologies) creatures.

> **Acronyms:** API (Application Programming Interface), MSE (Mean Squared
> Error), MAE (Mean Absolute Error), MAPE (Mean Absolute Percentage Error), MSLE
> (Mean Squared Logarithmic Error), SVM (Support Vector Machine), ReLU
> (Rectified Linear Unit), GELU (Gaussian Error Linear Unit), SELU (Scaled
> Exponential Linear Unit), ELU (Exponential Linear Unit), WASM (WebAssembly).

## 📦 Exports documented here

- `Costs`, `CostInterface`
- Cost → task descriptor: `costNameToTaskDescriptor`, `OTHER_COST_NAME`,
  `OTHER_TASK_DESCRIPTOR`, `TaskDescriptor`, `CostRange`, `CostTopology`,
  `DescriptorCostName`, `OutputSquashFamily`
- Activation function names (referenced in `NeuronExport.squash` and CRISPR DNA)

## 💰 Cost Functions

Cost functions measure the error between predicted and expected outputs.

```typescript
import { Costs } from "@stsoftware/neat-ai";
import type { CostInterface } from "@stsoftware/neat-ai";
```

### 📋 Built-in cost functions

| Name              | Class                          | Best For                     | Formula                                 |
| ----------------- | ------------------------------ | ---------------------------- | --------------------------------------- |
| `"MSE"`           | Mean Squared Error             | General regression (default) | `(1/n) * Sum((y - y')^2)`               |
| `"MAE"`           | Mean Absolute Error            | Regression with outliers     | `(1/n) * Sum(\|y - y'\|)`               |
| `"MAPE"`          | Mean Absolute Percentage Error | Forecasting, relative error  | `(1/n) * Sum(\|(y' - y) / y\|)`         |
| `"MSLE"`          | Mean Squared Logarithmic Error | Wide value ranges            | `(1/n) * Sum((log(y) - log(y'))^2)`     |
| `"CROSS_ENTROPY"` | Cross Entropy                  | Classification               | `-Sum(y * log(y') + (1-y) * log(1-y'))` |
| `"HINGE"`         | Hinge Loss                     | SVM / binary classification  | `max(0, 1 - y * y')`                    |

These six names make up `BUILT_IN_COST_NAMES`.

### 🦀 Native scorer off-load (`--cost`)

When the optional `rust_scorer` binary is enabled
(`NEAT_AI_RUST_SCORER_ENABLED`), NEAT-AI passes the configured `costName` to the
binary via `--cost <NAME>`. **All six `BUILT_IN_COST_NAMES` values are eligible
for native off-load** once the scorer release containing
[NEAT-AI-scorer#134](https://github.com/stSoftwareAU/NEAT-AI-scorer/issues/134)
is deployed.

- If the probed binary does not advertise `--cost`, a non-`MSE` cost falls back
  to WASM scoring (MSE is the binary's historical default and stays compatible
  without the flag).
- Custom (user-registered) costs are never off-loaded — they stay on the TS/WASM
  path because the binary cannot resolve them.

### 📐 CostInterface

Custom cost functions implement this interface:

```typescript
interface CostInterface {
  getName(): string;
  calculate(target: Float32Array, output: Float32Array): number;
}
```

### 🗂️ Costs registry

```typescript
// Find a cost function by name
const mse = Costs.find("MSE");
const error = mse.calculate(target, output);

// List all available costs
const names: string[] = Costs.getAvailableCosts();

// Register a custom cost function
Costs.registerCustomCost(myCustomCost);

// Register a factory (creates new instances on demand)
Costs.registerCostFactory("MY_COST", () => new MyCost());
```

### 🧭 Cost → task descriptor

`costNameToTaskDescriptor(costName)` maps a configured cost name to the
structural `TaskDescriptor` sent to Discovery. Built-in costs map to their
canonical descriptor; custom (user-registered) costs collapse to the `OTHER`
sentinel without leaking their real name.

```typescript
import {
  costNameToTaskDescriptor,
  OTHER_COST_NAME,
  OTHER_TASK_DESCRIPTOR,
} from "@stsoftware/neat-ai";
import type {
  CostRange,
  CostTopology,
  DescriptorCostName,
  OutputSquashFamily,
  TaskDescriptor,
} from "@stsoftware/neat-ai";

const descriptor = costNameToTaskDescriptor("MSE");
const custom = costNameToTaskDescriptor("MY_COST"); // === OTHER_TASK_DESCRIPTOR
```

```typescript
interface TaskDescriptor {
  readonly costName: DescriptorCostName;
  readonly topology: CostTopology;
  readonly range: CostRange;
  readonly outputSquashFamily: OutputSquashFamily;
}
```

| Type                 | Values                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| `CostRange`          | `"unbounded" \| "positive" \| "unit" \| "signed_unit"`                          |
| `CostTopology`       | `"independent" \| "simplex" \| "margin" \| "one_hot" \| "unknown"`              |
| `OutputSquashFamily` | `"unbounded" \| "positive" \| "bounded_unipolar" \| "bounded_bipolar" \| "any"` |
| `DescriptorCostName` | a built-in cost name, `"BINARY_CROSS_ENTROPY"`, or `"OTHER"`                    |

`OTHER_COST_NAME` is `"OTHER"`; `OTHER_TASK_DESCRIPTOR` is the fully-`unknown`
descriptor returned for any unrecognised cost.

#### FFI wire shape (Issue #3012)

The `TaskDescriptor` above uses snake_case **internal** names. NEAT-AI-Discovery
(the Rust consumer) deserialises a different, PascalCase shape, so every
descriptor crossing the FFI boundary is mapped through
`taskDescriptorToRustWire(descriptor, numOutputs)` first. Forwarding the
internal shape unchanged makes Rust fail with `unknown variant 'unbounded'`.

```typescript
interface RustWireTaskDescriptor {
  readonly targetTopology: RustWireTopology; // "Independent" | "Simplex" | …
  readonly targetRange: RustWireRange; // "Unbounded" | "Positive" | …
  readonly outputSquashFamily: RustWireSquashFamily; // "BoundedUnipolar" | …
  readonly numOutputs: number; // from the creature export
}
```

| Internal field       | Wire field           | Example mapping                        |
| -------------------- | -------------------- | -------------------------------------- |
| `topology`           | `targetTopology`     | `independent` → `Independent`          |
| `range`              | `targetRange`        | `signed_unit` → `SignedUnit`           |
| `outputSquashFamily` | `outputSquashFamily` | `bounded_unipolar` → `BoundedUnipolar` |
| _(none)_             | `numOutputs`         | output neuron count                    |
| `costName`           | _(dropped)_          | never sent on the wire                 |

```mermaid
flowchart LR
  A["costNameToTaskDescriptor<br/>(snake_case internal)"] --> B["taskDescriptorToRustWire<br/>(PascalCase wire)"]
  B --> C["recordDiscovery /<br/>analyzeParallel FFI"]
  C --> D["NEAT-AI-Discovery (Rust)"]
```

---

## ⚡ Activation Functions

NEAT-AI provides 39 activation functions (called "squash" functions). The
library uses WASM (WebAssembly) for all activation computation.

```typescript
// Activations are referenced by name in neuron definitions.
// The library handles activation internally via WASM.
```

### 📊 Summary table

Priority controls how often an activation is chosen during random mutation.
Higher priority means more likely to be selected.

> [!TIP]
> When in doubt, **LeakyReLU** (priority 10) is the default choice and works
> well for most general-purpose networks. For deeper architectures, consider
> **GELU** or **Swish**.

| Activation          | Priority | Range          | Best For                                  |
| ------------------- | :------: | -------------- | ----------------------------------------- |
| **LeakyReLU**       |    10    | (-Inf, +Inf)   | General purpose, default choice           |
| **GELU**            |    9     | ~(-0.17, +Inf) | Deep networks, transformer-style          |
| **Swish**           |    8     | ~(-0.28, +Inf) | Deep networks, smooth non-linearity       |
| **TANH**            |    8     | (-1, 1)        | Bounded output, recurrent networks        |
| **LOGISTIC**        |    7     | (0, 1)         | Binary classification, probability output |
| **Softplus**        |    7     | (0, +Inf)      | Smooth approximation to ReLU              |
| **Mish**            |    6     | ~(-0.31, +Inf) | Deep networks, stable gradients           |
| **ELU**             |    6     | (-1, +Inf)     | Regression, avoids dead neurons           |
| **SELU**            |    5     | ~(-1.76, +Inf) | Self-normalising networks                 |
| **HARD_TANH**       |    5     | [-1, 1]        | Fast bounded output                       |
| **ReLU**            |    5     | [0, +Inf)      | Simple, fast activation                   |
| **BENT_IDENTITY**   |    4     | (-Inf, +Inf)   | Always smooth, no dead zones              |
| **SOFTSIGN**        |    4     | (-1, 1)        | Soft alternative to TANH                  |
| **ArcTan**          |    4     | (-pi/2, pi/2)  | Smooth, always nonzero slope              |
| **ReLU6**           |    4     | [0, 6]         | Mobile/embedded applications              |
| **SINE**            |    3     | [-1, 1]        | Periodic patterns                         |
| **ABSOLUTE**        |    2     | [0, +Inf)      | Magnitude detection                       |
| **Cosine**          |    2     | [-1, 1]        | Periodic patterns                         |
| **Cube**            |    2     | (-Inf, +Inf)   | Non-linear, fast                          |
| **Exponential**     |    2     | (0, +Inf)      | Exponential growth patterns               |
| **GAUSSIAN**        |    2     | (0, 1]         | Radial basis patterns                     |
| **ISRU**            |    2     | (-1, 1)        | Smooth, fades in tails                    |
| **LogSigmoid**      |    2     | (-Inf, 0)      | Negative log-probability                  |
| **TAN**             |    2     | (-Inf, +Inf)   | Unbounded periodic                        |
| **BIPOLAR_SIGMOID** |    1     | (-1, 1)        | Symmetric sigmoid                         |
| **StdInverse**      |    1     | (-Inf, +Inf)   | Inverse function                          |
| **IDENTITY**        |    1     | (-Inf, +Inf)   | Pass-through (linear)                     |
| **COMPLEMENT**      |    0     | (-Inf, +Inf)   | Inversion (1 - x)                         |
| **STEP**            |    0     | {0, 1}         | Binary threshold                          |
| **IF**              |    0     | Conditional    | Multi-input conditional                   |
| **BIPOLAR**         |    0     | {-1, 1}        | Binary symmetric threshold                |
| **HYPOT**           |    0     | Special        | Euclidean distance                        |
| **HYPOTv2**         |    0     | Special        | Euclidean distance (variant)              |
| **SQRT**            |    1     | [0, +Inf)      | Square root transform                     |
| **SQUARE**          |    1     | [0, +Inf)      | Quadratic transform                       |
| **MAXIMUM**         |    0     | Special        | Max of inputs                             |
| **MEAN**            |    0     | (-Inf, +Inf)   | Mean of inputs (deprecated)               |
| **MINIMUM**         |    0     | Special        | Min of inputs                             |
| **SOFTMAX**         |    0     | (0, 1)         | Multi-class output (vector-normalised)    |

> [!NOTE]
> **SOFTMAX** is never picked by random mutation (priority `0`). It is intended
> as an output-layer activation: per-neuron it behaves like **LOGISTIC**, and
> true vector normalisation across the output layer happens at the caller layer.

For detailed backpropagation strategy notes, see
[`src/methods/activations/README.md`](../../src/methods/activations/README.md)
and the user-facing [`docs/ACTIVATION_FUNCTIONS.md`](../ACTIVATION_FUNCTIONS.md)
selection guide.

---

## 🔗 Related topics

- [Configuration reference](CONFIGURATION.md) — `costName` field on
  `NeatOptions`.
- [Training](TRAINING.md) — backpropagation uses cost functions to score each
  batch.
- [Interop](INTEROP.md) — `checkOnnxCompatibility()` rejects creatures that use
  aggregate activations (IF, MIN, MAX) or deprecated activations (HYPOT,
  HYPOTv2, MEAN).
- [`docs/ACTIVATION_FUNCTIONS.md`](../ACTIVATION_FUNCTIONS.md) — narrative
  selection guide for the 30+ built-in squash functions.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
