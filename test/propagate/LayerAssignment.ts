/**
 * Tests for LayerAssignment.ts
 *
 * Issue #1920 - Verifies that layer/level assignments are correctly computed
 * from network topology for all neuron types and edge cases.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";

Deno.test("LayerAssignment - simple chain assigns correct layers", () => {
  // Input → H1 → H2 → Output
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Should have 4 layers: input(0), h1(1), h2(2), output(3)
  assertEquals(layers.size, 4);

  // Layer 0 should contain the input neuron
  const layer0 = layers.get(0)!;
  assertEquals(layer0.length, 1);
  assertEquals(layer0[0], 0); // input-0

  // Layer 1 should contain h1
  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  const layer1 = layers.get(1)!;
  assertEquals(layer1.includes(h1Idx), true);

  // Layer 2 should contain h2
  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);
  const layer2 = layers.get(2)!;
  assertEquals(layer2.includes(h2Idx), true);

  // Final layer should contain the output neuron
  const outputIdx = creature.neurons.findIndex((n) => n.id === -1);
  const maxLayer = Math.max(...layers.keys());
  const finalLayer = layers.get(maxLayer)!;
  assertEquals(finalLayer.includes(outputIdx), true);
});

Deno.test("LayerAssignment - input neurons are always layer 0", () => {
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "input-2", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const layer0 = layers.get(0)!;
  // All 3 input neurons should be in layer 0
  assertEquals(layer0.includes(0), true);
  assertEquals(layer0.includes(1), true);
  assertEquals(layer0.includes(2), true);
});

Deno.test("LayerAssignment - output neurons are in the final layer", () => {
  const json: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const maxLayer = Math.max(...layers.keys());
  const finalLayer = layers.get(maxLayer)!;
  const o0Idx = creature.neurons.findIndex((n) => n.id === -1);
  const o1Idx = creature.neurons.findIndex((n) => n.id === -2);

  assertEquals(finalLayer.includes(o0Idx), true, "output-0 in final layer");
  assertEquals(finalLayer.includes(o1Idx), true, "output-1 in final layer");
});

Deno.test("LayerAssignment - no hidden neurons", () => {
  // Direct input → output
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Layer 0: inputs, Layer 1: output
  assertEquals(layers.size, 2);
  assertEquals(layers.get(0)!.length, 2); // 2 inputs
  assertEquals(layers.get(1)!.length, 1); // 1 output
});

Deno.test("LayerAssignment - skip connections assign longest path", () => {
  // Input → H1 → H2 → Output
  //       ↘──────────↗ (skip connection)
  // H1 gets input from input (layer 1)
  // H2 gets input from H1 (layer 2)
  // Output gets input from both H2 and input (should still be final layer)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 }, // Skip
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Output should be in the final layer (layer 3), not layer 1
  const maxLayer = Math.max(...layers.keys());
  assertEquals(maxLayer, 3);

  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);
  assertEquals(layers.get(1)!.includes(h1Idx), true);
  assertEquals(layers.get(2)!.includes(h2Idx), true);
});

Deno.test("LayerAssignment - self-loops are ignored", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h1", weight: 0.5 }, // Self-loop
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  assertEquals(layers.size, 3);
  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  assertEquals(layers.get(1)!.includes(h1Idx), true);
});

Deno.test("LayerAssignment - recurrent connections are ignored for layering", () => {
  // H1 → H2 → Output, but also H2 → H1 (recurrent back-edge)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "h1", weight: 0.5 }, // Recurrent back-edge
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);

  // H1 should be in a lower layer than H2, despite the back-edge
  const h1Layer = findLayerForNeuron(layers, h1Idx);
  const h2Layer = findLayerForNeuron(layers, h2Idx);
  assertEquals(
    h1Layer < h2Layer,
    true,
    "h1 should be in a lower layer than h2",
  );
});

Deno.test("LayerAssignment - constant neurons are in layer 0", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-1", bias: 1 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "const-1", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const constIdx = creature.neurons.findIndex((n) => n.id === 952513159);
  const layer0 = layers.get(0)!;
  assertEquals(layer0.includes(constIdx), true, "Constant neuron in layer 0");
});

Deno.test("LayerAssignment - diamond topology uses longest path", () => {
  // Input → H1 → H3 → Output
  //       ↘ H2 ↗
  // H1 and H2 both receive from input (layer 1)
  // H3 receives from both H1 and H2 (layer 2)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-0", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "h3", weight: 1 },
      { fromUUID: "h2", toUUID: "h3", weight: 1 },
      { fromUUID: "h3", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);
  const h3Idx = creature.neurons.findIndex((n) => n.id === 1003275);

  assertEquals(layers.get(1)!.includes(h1Idx), true, "h1 in layer 1");
  assertEquals(layers.get(1)!.includes(h2Idx), true, "h2 in layer 1");
  assertEquals(layers.get(2)!.includes(h3Idx), true, "h3 in layer 2");
});

Deno.test("LayerAssignment - asymmetric paths use longest path", () => {
  // Input → H1 → H2 → H3 → Output
  //              ↗ (skip from Input)
  // H1: layer 1 (from input)
  // H2: layer 2 (from H1, longest path, not layer 1 from input skip)
  // H3: layer 3 (from H2)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "input-0", toUUID: "h2", weight: 0.5 }, // Skip: input → h2
      { fromUUID: "h2", toUUID: "h3", weight: 1 },
      { fromUUID: "h3", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);
  const h2Layer = findLayerForNeuron(layers, h2Idx);
  // H2 should be layer 2 (longest path: input→h1→h2), not layer 1 (input→h2)
  assertEquals(h2Layer, 2, "h2 should be at layer 2 via longest path");
});

Deno.test("LayerAssignment - single hidden layer", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // 3 layers: input(0), hidden(1), output(2)
  assertEquals(layers.size, 3);
});

Deno.test("LayerAssignment - all neurons are assigned to exactly one layer", () => {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "input-2", toUUID: "h3", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "h3", weight: 1 },
      { fromUUID: "h3", toUUID: "output-0", weight: 1 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Collect all neuron indices from all layers
  const allIndices: number[] = [];
  for (const indices of layers.values()) {
    allIndices.push(...indices);
  }

  // Every neuron should appear exactly once
  assertEquals(allIndices.length, creature.neurons.length);
  const unique = new Set(allIndices);
  assertEquals(unique.size, creature.neurons.length, "No duplicates");
});

Deno.test("LayerAssignment - disconnected hidden neuron gets a valid layer", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h-disconnected", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Disconnected neuron should still be assigned somewhere
  const disconnectedIdx = creature.neurons.findIndex(
    (n) => n.id === 1557855680,
  );
  const disconnectedLayer = findLayerForNeuron(layers, disconnectedIdx);
  assertNotEquals(
    disconnectedLayer,
    -1,
    "Disconnected neuron must be assigned",
  );

  // It should not be in the output layer
  const maxLayer = Math.max(...layers.keys());
  assertNotEquals(
    disconnectedLayer,
    maxLayer,
    "Disconnected neuron should not be in output layer",
  );
});

Deno.test("LayerAssignment - production-sized topology is efficient", () => {
  // Build a creature with ~1000 neurons and many synapses
  const inputCount = 100;
  const hiddenCount = 800;
  const outputCount = 50;

  const neurons: CreatureExport["neurons"] = [];
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `h-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  // Connect inputs to first hidden layer
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < 10; j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `h-${j}`,
        weight: 1,
      });
    }
  }
  // Chain hidden neurons in groups
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `h-${i}`,
      toUUID: `h-${i + 1}`,
      weight: 1,
    });
  }
  // Connect last hidden neurons to outputs
  for (let i = hiddenCount - outputCount; i < hiddenCount; i++) {
    for (let j = 0; j < outputCount; j++) {
      synapses.push({
        fromUUID: `h-${i}`,
        toUUID: `output-${j}`,
        weight: 1,
      });
    }
  }

  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };

  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  // Verify all neurons are assigned
  let totalNeurons = 0;
  for (const indices of layers.values()) {
    totalNeurons += indices.length;
  }
  assertEquals(
    totalNeurons,
    creature.neurons.length,
    "All neurons should be assigned",
  );

  // Input neurons in layer 0
  const layer0 = layers.get(0)!;
  assertEquals(
    layer0.length >= inputCount,
    true,
    "Inputs should be in layer 0",
  );

  // Outputs in the final layer
  const maxLayer = Math.max(...layers.keys());
  const finalLayer = layers.get(maxLayer)!;
  assertEquals(
    finalLayer.length,
    outputCount,
    "All outputs should be in the final layer",
  );
});

Deno.test("LayerAssignment - forward-only creature with multiple inputs to same hidden", () => {
  // Multiple inputs feeding into the same hidden neuron
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "input-2", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const h1Idx = creature.neurons.findIndex((n) => n.id === 1003273);
  const h2Idx = creature.neurons.findIndex((n) => n.id === 1003274);

  // Both hidden neurons should be in layer 1
  assertEquals(layers.get(1)!.includes(h1Idx), true, "h1 in layer 1");
  assertEquals(layers.get(1)!.includes(h2Idx), true, "h2 in layer 1");
});

Deno.test("LayerAssignment - layers are numbered consecutively from 0", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const layers = computeLayerAssignments(creature);

  const layerNumbers = [...layers.keys()].sort((a, b) => a - b);
  for (let i = 0; i < layerNumbers.length; i++) {
    assertEquals(layerNumbers[i], i, `Layer ${i} should exist`);
  }
});

/**
 * Helper to find which layer a neuron index is in.
 * Returns -1 if not found.
 */
function findLayerForNeuron(
  layers: Map<number, number[]>,
  neuronIdx: number,
): number {
  for (const [layer, indices] of layers) {
    if (indices.includes(neuronIdx)) return layer;
  }
  return -1;
}
