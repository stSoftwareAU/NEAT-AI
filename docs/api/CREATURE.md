# 🐛 Creature API

Creature lifecycle, hand-edited gene modification, and serialisation types.

> **Acronyms:** API (Application Programming Interface), JSON (JavaScript Object
> Notation), UUID (Universally Unique Identifier), CRISPR (Clustered Regularly
> Interspaced Short Palindromic Repeats), WASM (WebAssembly), DNA
> (Deoxyribonucleic Acid).

## 📦 Exports documented here

- `Creature`, `CURRENT_CREATURE_SEMANTIC_VERSION`
- Creature factory: `creatureForProblem`, `creatureForDataset`,
  `scanTrainingData`, `pickHiddenCapacity`, `pickOutputSquashForProblem`,
  `rescaleWeightsForInit`, `targetInitStddev`,
  `DEAD_FEATURE_VARIANCE_THRESHOLD`, `HIGH_DIMENSIONAL_INPUT_THRESHOLD`,
  `ProblemSpec`, `DatasetFactoryOptions`, `DatasetScan`, `NumericRange`
- `CreatureUtil`
- `CRISPR`, `CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX`,
  `FROM_RELATIVE_DEMOTED_OUTPUT`, `validateDNA`, `CrisprInterface`
- `randomConnectMissing`
- `CreatureExport`, `CreatureTrace`, `NeuronExport`, `SynapseExport`
- `exportSnapshotJSON`, `normaliseCreatureExport`, `normalised`
- `Upgrade`, `upgradeTwo`
- `TypedTopology`

## 🐛 Creature

The central class representing a neural network (genome) in NEAT (NeuroEvolution
of Augmenting Topologies).

```typescript
import { Creature } from "@stsoftware/neat-ai";
```

### 🏗️ Constructor

```typescript
new Creature(input: number, output: number, options?: {
  lazyInitialization?: boolean;
  semanticVersion?: string;
})
```

| Parameter                    | Type      | Description                           |
| ---------------------------- | --------- | ------------------------------------- |
| `input`                      | `number`  | Number of input neurons               |
| `output`                     | `number`  | Number of output neurons              |
| `options.lazyInitialization` | `boolean` | Skip default wiring (used internally) |
| `options.semanticVersion`    | `string`  | Version tag for the creature format   |

### 📋 Properties

| Property          | Type                            | Description                                       |
| ----------------- | ------------------------------- | ------------------------------------------------- |
| `input`           | `number`                        | Number of input neurons                           |
| `output`          | `number`                        | Number of output neurons                          |
| `neurons`         | `Neuron[]`                      | All neurons in the network                        |
| `synapses`        | `Synapse[]`                     | All synapses (connections)                        |
| `score`           | `number \| undefined`           | Fitness score after evaluation                    |
| `uuid`            | `string \| undefined`           | Unique identifier                                 |
| `memetic`         | `MemeticInterface \| undefined` | Origin tracking metadata                          |
| `tags`            | `TagInterface[] \| undefined`   | User-defined metadata tags                        |
| `semanticVersion` | `string`                        | Creature format version                           |
| `forwardOnly`     | `boolean \| undefined`          | When `true`, no recurrent connections are allowed |

### 🔧 Key Methods

| Method               | Signature                                                                                   | Description                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `activate`           | `(input: Float32Array, feedbackLoop?: boolean): Float32Array`                               | Forward pass through the network using WASM. Returns output values.                                   |
| `activateAndTrace`   | `(input: Float32Array, feedbackLoop: boolean, sparseConfig: SparseConfig): Float32Array`    | Activation with tracing enabled for analysis.                                                         |
| `propagate`          | `(expected: Float32Array, config: BackPropagationConfig, sparseConfig: SparseConfig): void` | Backpropagation — propagates errors backwards through the network.                                    |
| `propagateUpdate`    | `(config: BackPropagationConfig, sparseConfig: SparseConfig): void`                         | Updates weights/biases based on propagated errors.                                                    |
| `record`             | `(expected: Float32Array): Map<number, DiscoverRecord>`                                     | Records expected outputs for discovery analysis. The map key is the runtime neuron `id` (a `number`). |
| `exportJSON`         | `(): CreatureExport`                                                                        | Canonical serialisation: wire UUIDs plus resolved runtime ids (`id` / `fromId` / `toId`).             |
| `exportSnapshotJSON` | `(): CreatureExport`                                                                        | Wire-only snapshot: same topology as `exportJSON` but omits numeric ids (sharing / schema checks).    |
| `traceJSON`          | `(): CreatureTrace`                                                                         | Exports with detailed trace information from last activation.                                         |
| `loadFrom`           | `(json: CreatureInternal \| CreatureExport, validate: boolean): void`                       | Loads creature structure from a JSON object.                                                          |
| `connect`            | `(from: number, to: number, weight: number, type?: SynapseType): Synapse`                   | Creates a synapse between two neurons.                                                                |
| `getSynapse`         | `(from: number, to: number): Synapse \| null`                                               | Gets the synapse between two neurons, or `null`.                                                      |
| `shallowClone`       | `(): Creature`                                                                              | Fast clone without JSON serialisation overhead.                                                       |
| `dispose`            | `(): void`                                                                                  | Releases all resources and memory.                                                                    |
| `clearCache`         | `(from?: number, to?: number): void`                                                        | Clears internal synapse connection caches.                                                            |

### ⚡ Static Methods

| Method     | Signature                                                                  | Description                                                                          |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `fromJSON` | `(json: CreatureInternal \| CreatureExport, validate?: boolean): Creature` | Creates a creature from a JSON object. Handles legacy format upgrades automatically. |

`Creature.evolveDir()` is documented in the [Evolution API](EVOLUTION.md) topic.

### 💡 Example

```typescript
const creature = new Creature(2, 1);
const output = creature.activate(new Float32Array([0.5, 0.3]));
console.log(output); // Float32Array with 1 element

const json = creature.exportJSON();
const clone = Creature.fromJSON(json);
```

`CURRENT_CREATURE_SEMANTIC_VERSION` is the canonical version string written into
freshly-exported creatures.

---

## 🏭 Creature factory

Issue #2794: build a smarter _initial_ creature from problem metadata or a
training-set scan, then hand it to `Creature.evolveDir()`. Evolution is
unchanged — the factory just provides a better starting point (sensible hidden
capacity, output squash matched to the cost, weight scaling, dead-feature
pruning, and output-bias warm-start).

```typescript
import {
  creatureForDataset,
  creatureForProblem,
  scanTrainingData,
} from "@stsoftware/neat-ai";
import type {
  DatasetFactoryOptions,
  DatasetScan,
  NumericRange,
  ProblemSpec,
} from "@stsoftware/neat-ai";
```

### `creatureForProblem(spec)`

Builds an initial creature from declared problem metadata.

```typescript
const creature = creatureForProblem({
  inputs: 8,
  outputs: 3,
  cost: "CROSS_ENTROPY",
  outputRange: { min: 0, max: 1 },
});
```

`ProblemSpec` fields (only `inputs` and `outputs` are required):

| Field               | Type           | Description                                          |
| ------------------- | -------------- | ---------------------------------------------------- |
| `inputs`            | `number`       | Number of input neurons                              |
| `outputs`           | `number`       | Number of output neurons                             |
| `cost`              | `string`       | Cost name used to pick the output squash family      |
| `inputRange`        | `NumericRange` | Expected input value range (`{ min, max }`)          |
| `outputRange`       | `NumericRange` | Expected output value range (`{ min, max }`)         |
| `hiddenCapacity`    | `number`       | Override the auto-chosen hidden-neuron count         |
| `hiddenSquash`      | `string`       | Override the hidden-layer activation function        |
| `feedbackEnabled`   | `boolean`      | Allow recurrent connections                          |
| `warmupGenerations` | `number`       | Suggested warm-up generations recorded on the genome |

### `creatureForDataset(records, options?)`

Scans a dataset first (adding dead-feature pruning and output-bias warm-start),
then builds the creature. `DatasetFactoryOptions` carries the same optional
fields as `ProblemSpec` minus `inputs` / `outputs` (those are inferred).

```typescript
const creature = creatureForDataset(records, { cost: "MSE" });
```

### `scanTrainingData(records)`

Returns a `DatasetScan` summary used by the factory and available to callers:

```typescript
interface DatasetScan {
  sampleCount: number;
  inputMean: Float32Array;
  inputVariance: Float32Array;
  deadInputIndices: number[];
  outputMean: Float32Array;
  outputVariance: Float32Array;
}
```

### Lower-level helpers and constants

- `pickHiddenCapacity(spec)` — the heuristic hidden-neuron count for a spec.
- `pickOutputSquashForProblem(spec)` — output squash name matched to the cost.
- `targetInitStddev(squash, fanIn, fanOut)` — initialisation standard deviation.
- `rescaleWeightsForInit(creature)` — rescales weights in place for a fresh
  creature.
- `DEAD_FEATURE_VARIANCE_THRESHOLD` (`1e-8`) — variance at or below which an
  input feature is treated as dead and pruned.
- `HIGH_DIMENSIONAL_INPUT_THRESHOLD` (`100`) — input count above which
  high-dimensional heuristics apply.

---

## ✂️ CRISPR

Targeted genetic modifications inspired by CRISPR (Clustered Regularly
Interspaced Short Palindromic Repeats) gene-editing technology. Allows
hand-crafted injection of neurons and synapses.

For the conventions, append+demote pattern, and full validation rules, see
[`docs/CRISPR_GUIDE.md`](../CRISPR_GUIDE.md).

```typescript
import {
  CRISPR,
  CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX,
  FROM_RELATIVE_DEMOTED_OUTPUT,
  validateDNA,
} from "@stsoftware/neat-ai";
import type { CrisprInterface } from "@stsoftware/neat-ai";
```

### 📐 Constants

| Constant                                | Value     | Description                                                                                     |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX` | `100_000` | Recommended `index` for the first output neuron in append-mode DNA.                             |
| `FROM_RELATIVE_DEMOTED_OUTPUT`          | `99_999`  | `fromRelative` value that resolves to the demoted previous `output-0` under the default anchor. |

### 🏗️ Constructor & Methods

```typescript
new CRISPR(creature: Creature)
```

| Method                 | Signature                                                                                            | Description                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `cleaveDNA`            | `(dna: CrisprInterface): Creature`                                                                   | Applies modifications and returns the edited creature.  |
| `editAliases` (static) | `(dna: CrisprInterface, aliases: Record<number, number> \| Record<string, string>): CrisprInterface` | Replaces neuron UUID (or numeric index) aliases in DNA. |

### 📐 CrisprInterface

```typescript
interface CrisprInterface {
  id: string; // Unique modification ID
  mode: "insert" | "append"; // insert: replace topology; append: add to existing
  neurons?: {
    uuid?: string;
    index?: number;
    type: "output" | "hidden";
    squash: string; // Activation function name
    bias: number;
  }[];
  synapses: {
    fromUUID?: string;
    toUUID?: string;
    weight: number;
    type?: "positive" | "negative" | "condition";
  }[];
}
```

`validateDNA(dna)` checks a `CrisprInterface` for structural issues and throws
`CrisprError` (see [Errors](ERRORS.md)) if the DNA is malformed.

---

## 🛠️ CreatureUtil and randomConnectMissing

```typescript
import { CreatureUtil, randomConnectMissing } from "@stsoftware/neat-ai";
```

- `CreatureUtil` — utility class with helpers for working with creatures (UUID
  assignment, structural normalisation).
- `randomConnectMissing(creature)` — connects neurons that lack required inward
  or outward connections by inserting random synapses. Used during topology
  repair after structural mutation.

---

## 💾 Serialisation types

### 📤 CreatureExport

The JSON format for serialising and deserialising creatures.

```typescript
import type {
  CreatureExport,
  CreatureTrace,
  NeuronExport,
  SynapseExport,
} from "@stsoftware/neat-ai";
```

```typescript
interface CreatureExport {
  input: number; // Number of input neurons
  output: number; // Number of output neurons
  neurons: NeuronExport[]; // Hidden and output neurons
  synapses: SynapseExport[]; // All connections
  forwardOnly?: boolean; // No recurrent connections
  memetic?: MemeticInterface; // Origin tracking
  semanticVersion?: string; // Format version
  tags?: TagInterface[]; // User-defined metadata
}
```

### 🧠 NeuronExport

```typescript
interface NeuronExport {
  uuid: string; // Unique neuron identifier
  type: "hidden" | "output" | "constant";
  bias: number; // Neuron bias value
  squash?: string; // Activation function name
  tags?: TagInterface[]; // User-defined metadata
}
```

Input neurons are implicit (defined by `input` count) and not included in the
`neurons` array.

### 🔗 SynapseExport

```typescript
interface SynapseExport {
  fromUUID: string; // Source neuron UUID
  toUUID: string; // Target neuron UUID
  weight: number; // Connection weight
  type?: "positive" | "negative" | "condition";
  tags?: TagInterface[]; // User-defined metadata
}
```

### 🔍 CreatureTrace

Extends `CreatureExport` with per-neuron and per-synapse trace information from
the last activation, useful for debugging and analysis.

```typescript
interface CreatureTrace extends CreatureExport {
  neurons: NeuronTrace[]; // Neurons with activation trace
  synapses: SynapseTrace[]; // Synapses with trace
}
```

### 🔧 Helpers

```typescript
import {
  exportSnapshotJSON,
  normaliseCreatureExport,
  normalised,
  TypedTopology,
} from "@stsoftware/neat-ai";
```

- `exportSnapshotJSON(creature)` — module-level helper equivalent to
  `creature.exportSnapshotJSON()` (wire-only snapshot used for sharing and
  schema checks).
- `normaliseCreatureExport(json)` / `normalised(json)` — Issue #1958: ensure
  legacy `CreatureExport` objects (with UUID strings) have integer `id`,
  `fromId`, and `toId` fields populated.
- `TypedTopology` — Issue #1957: typed-array representation of creature topology
  for reduced GC (Garbage Collection) pressure.

### 💡 Round-trip example

```typescript
import { Creature } from "@stsoftware/neat-ai";

const creature = new Creature(2, 1);
const json = creature.exportJSON();
const jsonString = JSON.stringify(json, null, 2);

const restored = Creature.fromJSON(JSON.parse(jsonString));

creature.activate(new Float32Array([0.5, 0.5]));
const trace = creature.traceJSON();
```

---

## 🔄 Upgrade and version migration

Legacy creature formats (v0.x, v1.x) are automatically upgraded when loaded via
`Creature.fromJSON()`. Use `upgradeTwo()` for explicit v2.0.0 migration.

```typescript
import { Upgrade, upgradeTwo } from "@stsoftware/neat-ai";

// Correct a creature export (fixes missing/incorrect data)
const corrected = Upgrade.correct(creatureJson, inputCount);

// Upgrade legacy CRISPR format
const upgradedDna = Upgrade.CRISPR(legacyDna);
```

`upgradeTwo(json)` migrates a v1.x creature in-place to the current v2 wire
format.

---

## 🔗 Related topics

- [Evolution API](EVOLUTION.md) — `Creature.evolveDir()`, selection, and
  mutation strategies.
- [Configuration reference](CONFIGURATION.md) — `NeatOptions` consumed by
  `Creature.evolveDir()`.
- [Errors](ERRORS.md) — `CrisprError` thrown by `validateDNA()`.
- [Compute / multithreading](COMPUTE.md) — WASM cache controls that affect
  `Creature.activate()`.
- [Discovery](DISCOVERY.md) — error-pattern-driven structural growth.
- [`CRISPR_GUIDE.md`](../CRISPR_GUIDE.md) — full DNA conventions.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
