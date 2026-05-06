# 📤 Interop and Specialised Tooling

Transfer learning, ONNX export, topology export, and the Intelligent Design
squash optimiser — entry points that connect NEAT-AI to external
machine-learning pipelines and tooling.

> **Acronyms:** API (Application Programming Interface), ONNX (Open Neural
> Network Exchange), JSON (JavaScript Object Notation), DOT (Graphviz
> description language), UUID (Universally Unique Identifier), ML (Machine
> Learning).

## 📦 Exports documented here

- Transfer learning: `exportCheckpoint`, `importCheckpoint`,
  `createSeededPopulation`, `CheckpointInterface`, `CheckpointMetadata`,
  `CheckpointExportOptions`, `CheckpointImportOptions`,
  `PopulationSeedingOptions`
- ONNX: `exportToOnnx`, `checkOnnxCompatibility`, `isSquashSupported`,
  `OnnxCompatibilityResult`, `OnnxExportOptions`
- Topology export: `exportTopologyDot`, `exportTopologyJson`,
  `TopologyExportJson`, `TopologyExportNode`, `TopologyExportSynapse`
- Intelligent Design: `alternativeSquashes`, `cleanKnowledge`,
  `combineImprovements`, `combineKnowledge`, `getNeuronsToTest`,
  `getValidNeuronSquashes`, `makeModifiedCreature`,
  `makeModifiedCreatureWithPrevious`, `safeWriteJson`, `safeWriteJsonSync`,
  `scanForSquashImprovements`, `shuffle`, `IntelligentDesignWorkerHandler`,
  `BestNeuronSquash`, `TacitKnowledgeMap`

---

## 📦 Transfer Learning

Issue #1861: reuse trained creatures across related tasks. Export a creature as
a checkpoint with metadata, then import it into a new task — optionally freezing
weights and mapping UUIDs between different input/output configurations.

```typescript
import {
  createSeededPopulation,
  exportCheckpoint,
  importCheckpoint,
} from "@stsoftware/neat-ai";

import type {
  CheckpointExportOptions,
  CheckpointImportOptions,
  CheckpointInterface,
  CheckpointMetadata,
  PopulationSeedingOptions,
} from "@stsoftware/neat-ai";
```

### `exportCheckpoint(creature, options?)`

Exports a trained creature as a checkpoint with transfer learning metadata.

```typescript
const checkpoint = exportCheckpoint(creature, {
  sourceTask: "price-prediction",
  description: "Trained on 6 months of market data",
  generations: 5000,
  frozenNeuronUUIDs: ["uuid-1", "uuid-2"], // freeze learned features
});

// Save to disk
Deno.writeTextFileSync("checkpoint.json", JSON.stringify(checkpoint));
```

| Parameter                   | Type       | Description                                     |
| --------------------------- | ---------- | ----------------------------------------------- |
| `creature`                  | `Creature` | The trained creature to export                  |
| `options.sourceTask`        | `string`   | Human-readable name for the source task         |
| `options.description`       | `string`   | Description of what the creature was trained on |
| `options.generations`       | `number`   | Number of generations trained                   |
| `options.frozenNeuronUUIDs` | `string[]` | Neuron UUIDs to mark as frozen                  |
| `options.frozenSynapseKeys` | `string[]` | Synapse keys to mark as frozen                  |

**Returns:** `CheckpointInterface` — serialisable checkpoint object.

### `importCheckpoint(checkpoint, inputCount, outputCount)`

Imports a checkpoint to create a creature for a new task, handling UUID mapping
when input/output dimensions differ from the source task.

```typescript
const checkpoint = JSON.parse(Deno.readTextFileSync("checkpoint.json"));
const creature = importCheckpoint(checkpoint, 8, 3); // new task: 8 inputs, 3 outputs
```

### `createSeededPopulation(options)`

Creates an initial population mixing pre-trained creatures with randomly
initialised ones.

```typescript
const population = createSeededPopulation({
  inputCount: 8,
  outputCount: 3,
  populationSize: 50,
  seeds: [checkpointA.creature, checkpointB.creature],
  layers: [{ count: 5, squash: "TANH" }],
});
```

| Parameter        | Type               | Description                                |
| ---------------- | ------------------ | ------------------------------------------ |
| `inputCount`     | `number`           | Number of inputs for the target task       |
| `outputCount`    | `number`           | Number of outputs for the target task      |
| `populationSize` | `number`           | Total population size (including seeds)    |
| `seeds`          | `CreatureExport[]` | Pre-trained creatures to include as seeds  |
| `layers`         | `object[]`         | Optional layer config for random creatures |

**Returns:** `CreatureExport[]` — array of creature exports ready for evolution.

---

## 📤 ONNX Export

Issue #1866: Export trained NEAT (NeuroEvolution of Augmenting Topologies)
creatures to the [ONNX](https://onnx.ai/) (Open Neural Network Exchange) format
for deployment in standard ML (Machine Learning) pipelines. The exported model
produces identical outputs to the original creature (within floating-point
precision).

```typescript
import {
  checkOnnxCompatibility,
  exportToOnnx,
  isSquashSupported,
} from "@stsoftware/neat-ai";

import type {
  OnnxCompatibilityResult,
  OnnxExportOptions,
} from "@stsoftware/neat-ai";
```

### `checkOnnxCompatibility(creature)`

Checks whether a creature can be exported to ONNX format. Aggregate functions
(IF, MINIMUM, MAXIMUM) and deprecated functions (HYPOT, HYPOTv2, MEAN) are not
supported.

```typescript
const compat: OnnxCompatibilityResult = checkOnnxCompatibility(creature);
if (!compat.compatible) {
  console.log("Unsupported squashes:", compat.unsupportedSquashes);
}
```

| Field                 | Type       | Description                                |
| --------------------- | ---------- | ------------------------------------------ |
| `compatible`          | `boolean`  | Whether the creature can be exported       |
| `unsupportedSquashes` | `string[]` | List of unsupported squash functions found |

`isSquashSupported(name)` is the per-squash predicate used internally to build
that list.

### `exportToOnnx(creature, options?)`

Converts a creature to an ONNX binary model.

```typescript
const onnxBytes = exportToOnnx(creature, { graphName: "my-model" });
Deno.writeFileSync("model.onnx", onnxBytes);
```

| Parameter           | Type       | Description                                          |
| ------------------- | ---------- | ---------------------------------------------------- |
| `creature`          | `Creature` | The creature to export                               |
| `options.graphName` | `string`   | Name for the ONNX graph (default: `"neat_creature"`) |

**Returns:** `Uint8Array` — binary ONNX model.

> [!WARNING]
> Recurrent connections (feedback loops) are not supported in ONNX export.
> Creatures must use feed-forward topology only.

---

## 🗺️ Topology export (DOT / JSON)

Issue #2417: Thin wrappers over the NEAT-AI-core `CompiledNetwork.to_dot` and
`CompiledNetwork.to_topology_json` bindings. Returns Graphviz DOT or structured
JSON for external tooling (renderers, snapshots, viewers) without
re-implementing the formatter on the TypeScript side.

```typescript
import { exportTopologyDot, exportTopologyJson } from "@stsoftware/neat-ai";

import type {
  TopologyExportJson,
  TopologyExportNode,
  TopologyExportSynapse,
} from "@stsoftware/neat-ai";

const dot = exportTopologyDot(creature); // Graphviz string
const json: TopologyExportJson = exportTopologyJson(creature);
```

`TopologyExportNode` and `TopologyExportSynapse` describe the shape of the
entries inside `TopologyExportJson.nodes` and `.synapses`.

---

## 🧠 Intelligent Design (squash optimiser)

Systematic optimisation of activation functions per neuron via brute-force
search. Tests alternative squash functions and applies the best combination.

```typescript
import {
  alternativeSquashes,
  cleanKnowledge,
  combineImprovements,
  combineKnowledge,
  getNeuronsToTest,
  getValidNeuronSquashes,
  IntelligentDesignWorkerHandler,
  makeModifiedCreature,
  makeModifiedCreatureWithPrevious,
  safeWriteJson,
  safeWriteJsonSync,
  scanForSquashImprovements,
  shuffle,
} from "@stsoftware/neat-ai";

import type { BestNeuronSquash, TacitKnowledgeMap } from "@stsoftware/neat-ai";
```

For the complete narrative guide, see
[`docs/INTELLIGENT_DESIGN.md`](../INTELLIGENT_DESIGN.md).

---

## 🔗 Related topics

- [Creature](CREATURE.md) — `Creature.exportJSON()` produces the
  `CreatureExport` consumed by transfer learning and ONNX paths.
- [Costs and activations](COSTS_AND_ACTIVATIONS.md) — squash names that
  determine ONNX compatibility.
- [Evolution API](EVOLUTION.md) — `createSeededPopulation()` integrates with
  `Creature.evolveDir()`.
- [`docs/INTELLIGENT_DESIGN.md`](../INTELLIGENT_DESIGN.md) — squash optimisation
  guide.
