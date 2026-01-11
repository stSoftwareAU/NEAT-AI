/**
 * Benchmark for createCompatibleFather performance optimisation.
 *
 * Issue #1034: Avoid JSON exports in parent selection compatibility check.
 *
 * This benchmark compares:
 * 1. Original approach: Export both parents to JSON, then run compatibility check
 * 2. Optimised approach: Work directly with Creature objects, avoiding double export
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/FatherCompatibility.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import {
  createCompatibleFather,
  createCompatibleFatherFromCreatures,
} from "../src/breed/Father.ts";

/**
 * Creates a creature with many neurons and synapses to simulate a large creature.
 * Based on the issue description, large creatures can be ~500KB each.
 */
function createLargeCreature(
  neuronCount: number,
  prefix: string,
  inputCount: number = 20,
  outputCount: number = 10,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add hidden neurons in multiple layers
  for (let i = 0; i < neuronCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: i % 3 === 0 ? "TANH" : i % 3 === 1 ? "IDENTITY" : "LeakyReLU",
      bias: 0.1 * (i % 10),
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Connect inputs to first layer of hidden neurons
  const firstLayerSize = Math.min(neuronCount, 30);
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < firstLayerSize; j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-hidden-${j}`,
        weight: 0.5 * ((i + j) % 10) / 10,
      });
    }
  }

  // Chain hidden neurons with multiple connections
  for (let i = 0; i < neuronCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: 0.5,
    });

    // Add skip connections
    if (i % 5 === 0 && i + 5 < neuronCount) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${i}`,
        toUUID: `${prefix}-hidden-${i + 5}`,
        weight: 0.3,
      });
    }
    if (i % 10 === 0 && i + 10 < neuronCount) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${i}`,
        toUUID: `${prefix}-hidden-${i + 10}`,
        weight: 0.2,
      });
    }
  }

  // Connect last hidden neurons to outputs
  const lastLayerStart = Math.max(0, neuronCount - 30);
  for (let i = lastLayerStart; i < neuronCount; i++) {
    for (let j = 0; j < outputCount; j++) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${i}`,
        toUUID: `output-${j}`,
        weight: 0.5,
      });
    }
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  });

  creature.validate();
  return creature;
}

// Create large creatures for benchmarking
const mother = createLargeCreature(300, "mother");
const father = createLargeCreature(300, "father");

// Report creature sizes for context
const motherJson = mother.exportJSON();
const fatherJson = father.exportJSON();
const motherSize = JSON.stringify(motherJson).length;
const fatherSize = JSON.stringify(fatherJson).length;
console.log(
  `Creature sizes: Mother=${(motherSize / 1024).toFixed(1)}KB, Father=${
    (fatherSize / 1024).toFixed(1)
  }KB`,
);
console.log(
  `Neurons: Mother=${motherJson.neurons.length}, Father=${fatherJson.neurons.length}`,
);
console.log(
  `Synapses: Mother=${motherJson.synapses.length}, Father=${fatherJson.synapses.length}`,
);

// Benchmark the complete compatibility check including the final Creature.fromJSON
Deno.bench({
  name: "Original (with exportJSON)",
  fn() {
    const motherExport = mother.exportJSON();
    const fatherExport = father.exportJSON();
    const result = createCompatibleFather(motherExport, fatherExport);
    Creature.fromJSON(result);
  },
});

Deno.bench({
  name: "Optimised (direct Creature access)",
  fn() {
    const result = createCompatibleFatherFromCreatures(mother, father);
    Creature.fromJSON(result);
  },
});

// Also benchmark just the export overhead to show where time is saved
Deno.bench({
  name: "Export overhead only (mother + father)",
  fn() {
    mother.exportJSON();
    father.exportJSON();
  },
});

// Benchmark just the compatibility check logic (no Creature.fromJSON)
Deno.bench({
  name: "Original compatibility only",
  fn() {
    const motherExport = mother.exportJSON();
    const fatherExport = father.exportJSON();
    createCompatibleFather(motherExport, fatherExport);
  },
});

Deno.bench({
  name: "Optimised compatibility only",
  fn() {
    createCompatibleFatherFromCreatures(mother, father);
  },
});
