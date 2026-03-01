/**
 * Issue #1641 - Diagnostic: Measure neuron revisit frequency during backpropagation.
 *
 * This script counts how many times each neuron is visited during a single
 * backward pass, which determines whether topological ordering would help.
 *
 * Run with:
 *   deno run --allow-read --allow-env bench/RevisitDiagnostic.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1641);
const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];

function buildNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerUUIDs: string[][] = [];
  const inputUUIDs = Array.from(
    { length: inputCount },
    (_, i) => `input-${i}`,
  );
  layerUUIDs.push(inputUUIDs);
  for (let layerIdx = 0; layerIdx < hiddenLayers.length; layerIdx++) {
    const layerSize = hiddenLayers[layerIdx];
    const uuids: string[] = [];
    for (let i = 0; i < layerSize; i++) {
      const uuid = `hidden-${layerIdx}-${i}`;
      uuids.push(uuid);
      neurons.push({
        type: "hidden",
        uuid,
        squash:
          SQUASH_NAMES[Math.floor(Math.abs(random()) * SQUASH_NAMES.length)],
        bias: random() * 0.5,
      });
    }
    layerUUIDs.push(uuids);
  }
  const outputUUIDs: string[] = [];
  for (let i = 0; i < outputCount; i++) {
    const uuid = `output-${i}`;
    outputUUIDs.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "IDENTITY",
      bias: random() * 0.1,
    });
  }
  layerUUIDs.push(outputUUIDs);
  for (let l = 0; l < layerUUIDs.length - 1; l++) {
    const fromLayer = layerUUIDs[l];
    const toLayer = layerUUIDs[l + 1];
    for (const fromUUID of fromLayer) {
      const fanOut = Math.min(maxFanOut, toLayer.length);
      const connected = new Set<number>();
      while (connected.size < fanOut) {
        const targetIdx = Math.floor(Math.abs(random()) * toLayer.length);
        if (!connected.has(targetIdx)) {
          connected.add(targetIdx);
          synapses.push({
            fromUUID,
            toUUID: toLayer[targetIdx],
            weight: random() * 0.5,
          });
        }
      }
    }
  }
  return { input: inputCount, output: outputCount, neurons, synapses };
}

const configs = [
  {
    name: "small (44N, 1 output)",
    input: 3,
    output: 1,
    layers: [20, 20],
    fanOut: 8,
  },
  {
    name: "medium (117N, 2 outputs)",
    input: 5,
    output: 2,
    layers: [40, 40, 30],
    fanOut: 10,
  },
  {
    name: "large (223N, 3 outputs)",
    input: 10,
    output: 3,
    layers: [60, 60, 50, 40],
    fanOut: 12,
  },
];

const backpropConfig = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 64,
});

console.log("=".repeat(70));
console.log("Issue #1641: Neuron Revisit Frequency Diagnostic");
console.log("=".repeat(70));

for (const cfg of configs) {
  const json = buildNetwork(cfg.input, cfg.output, cfg.layers, cfg.fanOut);
  const creature = Creature.fromJSON(json);

  const sparseConfig = new SparseConfig(json, backpropConfig);

  const input = new Float32Array(
    Array.from({ length: cfg.input }, () => random() * 0.5 + 0.5),
  );
  const target = new Float32Array(
    Array.from({ length: cfg.output }, () => random() * 0.5),
  );

  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, backpropConfig, sparseConfig);

  const neurons = creature.neurons;
  let totalVisits = 0;
  let hiddenOutputCount = 0;
  let maxVisits = 0;
  let multiVisitNeurons = 0;

  for (let i = cfg.input; i < neurons.length; i++) {
    const n = neurons[i];
    if (n.type === "hidden" || n.type === "output") {
      const ns = creature.state.node(i);
      totalVisits += ns.count;
      hiddenOutputCount++;
      if (ns.count > maxVisits) maxVisits = ns.count;
      if (ns.count > 1) multiVisitNeurons++;
    }
  }

  console.log(`\n${cfg.name}:`);
  console.log(`  Hidden+Output neurons: ${hiddenOutputCount}`);
  console.log(`  Total visits (ns.count): ${totalVisits}`);
  console.log(
    `  Average visits per neuron: ${
      (totalVisits / hiddenOutputCount).toFixed(2)
    }`,
  );
  console.log(`  Max visits to any neuron: ${maxVisits}`);
  console.log(
    `  Neurons visited >1 time: ${multiVisitNeurons} (${
      (multiVisitNeurons / hiddenOutputCount * 100).toFixed(1)
    }%)`,
  );
  console.log(`  Synapses: ${creature.synapses.length}`);
}
