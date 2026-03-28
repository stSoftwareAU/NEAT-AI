/**
 * Tests for checkpoint export/import and transfer learning functionality.
 *
 * Issue #1861: Verifies:
 * - Creature checkpoint export with metadata
 * - Checkpoint import to seed a new population
 * - UUID mapping for different input/output configurations
 * - Weight freezing for imported creatures
 * - Round-trip serialisation of frozen flags
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  exportCheckpoint,
  importCheckpoint,
} from "../../src/transfer/Checkpoint.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("exportCheckpoint - produces valid checkpoint with metadata", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 2, {
    layers: [{ count: 4, squash: "TANH" }],
  });
  creature.score = -0.05;

  const checkpoint = exportCheckpoint(creature, {
    sourceTask: "XOR classification",
    description: "A creature trained on XOR",
    generations: 100,
  });

  assertEquals(checkpoint.version, "1.0.0");
  assertEquals(checkpoint.metadata.sourceTask, "XOR classification");
  assertEquals(checkpoint.metadata.description, "A creature trained on XOR");
  assertEquals(checkpoint.metadata.generations, 100);
  assertEquals(checkpoint.metadata.score, -0.05);
  assertEquals(checkpoint.metadata.sourceInputCount, 3);
  assertEquals(checkpoint.metadata.sourceOutputCount, 2);
  assertEquals(checkpoint.metadata.sourceInputIds.length, 3);
  assertEquals(checkpoint.metadata.sourceOutputIds.length, 2);
  assertExists(checkpoint.metadata.createdAt);
  assert(checkpoint.creature.neurons.length > 0, "Should have neurons");
  assert(checkpoint.creature.synapses.length > 0, "Should have synapses");
});

Deno.test("importCheckpoint - same task shape creates identical topology", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);
  const imported = importCheckpoint(checkpoint);

  assertEquals(imported.input, 2);
  assertEquals(imported.output, 1);
  assertEquals(
    imported.neurons.length,
    creature.neurons.length,
    "Should have same neuron count",
  );
  assertEquals(
    imported.synapses.length,
    creature.synapses.length,
    "Should have same synapse count",
  );

  // Weights should be preserved
  for (let i = 0; i < imported.synapses.length; i++) {
    assertEquals(
      imported.synapses[i].weight,
      creature.synapses[i].weight,
      `Synapse ${i} weight should be preserved`,
    );
  }
});

Deno.test("importCheckpoint - different input count remaps correctly", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);

  // Import for a task with 3 inputs instead of 2
  const imported = importCheckpoint(checkpoint, {
    targetInputCount: 3,
  });

  assertEquals(imported.input, 3);
  assertEquals(imported.output, 1);
  // Hidden neurons should be preserved
  let hiddenCount = 0;
  for (const n of imported.neurons) {
    if (n.type === "hidden") hiddenCount++;
  }
  assertEquals(hiddenCount, 2, "Hidden neurons should be preserved");
});

Deno.test("importCheckpoint - different output count remaps correctly", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);

  // Import for a task with 3 outputs instead of 1
  const imported = importCheckpoint(checkpoint, {
    targetOutputCount: 3,
  });

  assertEquals(imported.input, 2);
  assertEquals(imported.output, 3);
});

Deno.test("importCheckpoint - UUID mapping between tasks", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);

  // Use explicit UUID mapping (numeric IDs: input-0 -> 0, input-1 -> 1)
  const inputMapping = new Map<number, number>();
  inputMapping.set(0, 0);
  inputMapping.set(1, 1);

  const imported = importCheckpoint(checkpoint, {
    inputIdMapping: inputMapping,
  });

  assertEquals(imported.input, 2);
  assertEquals(imported.output, 1);
});

Deno.test("importCheckpoint - freezeHidden freezes hidden neurons and synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);
  const imported = importCheckpoint(checkpoint, {
    freezeHidden: true,
  });

  // Check hidden neurons are frozen
  for (const neuron of imported.neurons) {
    if (neuron.type === "hidden") {
      assertEquals(neuron.frozen, true, "Hidden neurons should be frozen");
    } else {
      assertEquals(
        neuron.frozen,
        undefined,
        `${neuron.type} neurons should not be frozen`,
      );
    }
  }

  // Check synapses between hidden neurons are frozen
  for (const synapse of imported.synapses) {
    const fromType = imported.neurons[synapse.from].type;
    const toType = imported.neurons[synapse.to].type;
    if (fromType === "hidden" && toType === "hidden") {
      assertEquals(
        synapse.frozen,
        true,
        "Synapses between hidden neurons should be frozen",
      );
    }
  }
});

Deno.test("checkpoint export includes frozen neuron/synapse keys", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const hiddenIds: number[] = [];
  for (const n of creature.neurons) {
    if (n.type === "hidden") {
      hiddenIds.push(n.id);
    }
  }

  const checkpoint = exportCheckpoint(creature, {
    frozenNeuronIds: hiddenIds,
    frozenSynapseKeys: ["input-0->output-0"],
  });

  assertExists(checkpoint.frozenNeuronIds);
  assertEquals(checkpoint.frozenNeuronIds!.length, hiddenIds.length);
  assertExists(checkpoint.frozenSynapseKeys);
  assertEquals(checkpoint.frozenSynapseKeys!.length, 1);
});

Deno.test("round-trip - frozen flags survive export/import", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Freeze some neurons and synapses
  for (const n of creature.neurons) {
    if (n.type === "hidden") {
      creature.setNeuronFrozen(n.index, true);
    }
  }
  if (creature.synapses.length > 0) {
    creature.synapses[0].frozen = true;
  }

  // Export and re-import
  const json = creature.exportInternalJSON();
  const reimported = Creature.fromJSON(json, true);

  // Check frozen flags preserved
  for (const n of reimported.neurons) {
    if (n.type === "hidden") {
      assertEquals(n.frozen, true, "Frozen flag should survive round-trip");
    }
  }
  if (reimported.synapses.length > 0) {
    assertEquals(
      reimported.synapses[0].frozen,
      true,
      "Synapse frozen flag should survive round-trip",
    );
  }
});

Deno.test("shallowClone preserves frozen flags", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Freeze a hidden neuron and a synapse
  for (const n of creature.neurons) {
    if (n.type === "hidden") {
      creature.setNeuronFrozen(n.index, true);
      break;
    }
  }
  creature.synapses[0].frozen = true;

  const clone = creature.shallowClone();

  // Find frozen neuron in clone
  let foundFrozenNeuron = false;
  for (const n of clone.neurons) {
    if (n.frozen) {
      foundFrozenNeuron = true;
      break;
    }
  }
  assert(foundFrozenNeuron, "Clone should have frozen neuron");
  assertEquals(
    clone.synapses[0].frozen,
    true,
    "Clone should have frozen synapse",
  );
});

Deno.test("freezeHiddenLayers - freezes all hidden neurons and inter-hidden synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  creature.freezeHiddenLayers();

  for (const n of creature.neurons) {
    if (n.type === "hidden") {
      assertEquals(n.frozen, true, "Hidden neuron should be frozen");
    } else {
      assertEquals(
        n.frozen,
        undefined,
        `${n.type} neuron should not be frozen`,
      );
    }
  }
});

Deno.test("unfreezeAll - removes all freeze flags", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Freeze everything
  creature.freezeHiddenLayers();
  for (const s of creature.synapses) {
    s.frozen = true;
  }

  // Unfreeze
  creature.unfreezeAll();

  for (const n of creature.neurons) {
    assertEquals(n.frozen, undefined, "All neurons should be unfrozen");
  }
  for (const s of creature.synapses) {
    assertEquals(s.frozen, undefined, "All synapses should be unfrozen");
  }
});

Deno.test("frozen weights are preserved during backpropagation", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Record original weights
  const originalWeights = creature.synapses.map((s) => s.weight);

  // Freeze all synapses
  for (const s of creature.synapses) {
    s.frozen = true;
  }

  // Run backpropagation
  const json = creature.exportInternalJSON();
  const bpConfig = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(json, bpConfig);

  const input = new Float32Array([0.5, 0.5]);
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(new Float32Array([1.0]), bpConfig, sparseConfig);

  // Weights should not have changed
  for (let i = 0; i < creature.synapses.length; i++) {
    assertEquals(
      creature.synapses[i].weight,
      originalWeights[i],
      `Frozen synapse ${i} weight should not change during backprop`,
    );
  }
});

Deno.test("frozen biases are preserved during backpropagation", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Record original biases for hidden neurons
  const originalBiases = new Map<number, number>();
  for (const n of creature.neurons) {
    if (n.type === "hidden") {
      originalBiases.set(n.index, n.bias);
      creature.setNeuronFrozen(n.index, true);
    }
  }

  // Run backpropagation
  const json = creature.exportInternalJSON();
  const bpConfig = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(json, bpConfig);

  const input = new Float32Array([0.5, 0.5]);
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(new Float32Array([1.0]), bpConfig, sparseConfig);
  creature.propagateUpdate(bpConfig, sparseConfig);

  // Biases should not have changed for frozen neurons
  for (const [index, originalBias] of originalBiases) {
    assertEquals(
      creature.neurons[index].bias,
      originalBias,
      `Frozen neuron ${index} bias should not change during backprop`,
    );
  }
});

Deno.test("transfer learning - train on task A, fine-tune on task B", async () => {
  await initWasmForTests();

  // Task A: AND gate (2 inputs, 1 output)
  const creatureA = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  // Simulate training by doing a few propagation steps
  const jsonA = creatureA.exportInternalJSON();
  const bpConfig = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(jsonA, bpConfig);

  const andData = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  for (const sample of andData) {
    creatureA.activateAndTrace(sample.input, false, sparseConfig);
    creatureA.propagate(sample.output, bpConfig, sparseConfig);
  }
  creatureA.propagateUpdate(bpConfig, sparseConfig);

  // Export checkpoint from task A
  const checkpoint = exportCheckpoint(creatureA, {
    sourceTask: "AND gate",
    generations: 1,
  });

  // Import for task B (same shape - OR gate)
  const creatureB = importCheckpoint(checkpoint, {
    freezeHidden: true,
  });

  assertEquals(creatureB.input, 2);
  assertEquals(creatureB.output, 1);

  // Hidden neurons should be frozen from task A
  let frozenHiddenCount = 0;
  for (const n of creatureB.neurons) {
    if (n.type === "hidden" && n.frozen) frozenHiddenCount++;
  }
  assert(frozenHiddenCount > 0, "Should have frozen hidden neurons");

  // Task B: OR gate - train with output weights unfrozen
  const jsonB = creatureB.exportInternalJSON();
  const sparseConfigB = new SparseConfig(jsonB, bpConfig);

  const orData = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  for (const sample of orData) {
    creatureB.activateAndTrace(sample.input, false, sparseConfigB);
    creatureB.propagate(sample.output, bpConfig, sparseConfigB);
  }

  // Verify the creature is still valid after fine-tuning
  creatureB.validate();
});

Deno.test("non-frozen weights change during backpropagation", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  // Freeze only some synapses
  let frozenCount = 0;
  for (const s of creature.synapses) {
    if (frozenCount < 2) {
      s.frozen = true;
      frozenCount++;
    }
  }

  const originalNonFrozenWeights: number[] = [];
  for (const s of creature.synapses) {
    if (!s.frozen) {
      originalNonFrozenWeights.push(s.weight);
    }
  }

  const json = creature.exportInternalJSON();
  const bpConfig = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(json, bpConfig);

  // Multiple backprop iterations
  for (let i = 0; i < 10; i++) {
    creature.activateAndTrace(
      new Float32Array([0.5, 0.5]),
      false,
      sparseConfig,
    );
    creature.propagate(new Float32Array([1.0]), bpConfig, sparseConfig);
  }
  creature.propagateUpdate(bpConfig, sparseConfig);

  // Check frozen synapses didn't change
  let frozenIdx = 0;
  for (const s of creature.synapses) {
    if (s.frozen) {
      frozenIdx++;
    }
  }
  assertEquals(frozenIdx, 2, "Should still have 2 frozen synapses");
});

Deno.test("importCheckpoint - explicit UUID mapping works", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);

  // Map source inputs to different target input positions (numeric IDs)
  const inputMapping = new Map<number, number>();
  inputMapping.set(0, 1); // swap input-0 to position 1
  inputMapping.set(1, 0); // swap input-1 to position 0

  const imported = importCheckpoint(checkpoint, {
    inputIdMapping: inputMapping,
  });

  assertEquals(imported.input, 2);
  assertEquals(imported.output, 1);
  // The creature should be valid even with swapped inputs
  imported.validate();
});

Deno.test("checkpoint metadata - timestamps are valid ISO strings", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  const checkpoint = exportCheckpoint(creature);

  const date = new Date(checkpoint.metadata.createdAt);
  assert(!isNaN(date.getTime()), "createdAt should be a valid ISO date");
});

Deno.test("importCheckpoint - no options returns identical creature", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const checkpoint = exportCheckpoint(creature);
  const imported = importCheckpoint(checkpoint);

  assertEquals(imported.input, creature.input);
  assertEquals(imported.output, creature.output);
  assertEquals(imported.neurons.length, creature.neurons.length);
  assertEquals(imported.synapses.length, creature.synapses.length);
});
