/**
 * Issue #1209 - SIMD 8-Way Batching Performance Benchmark
 *
 * This benchmark measures the performance improvement from 8-record SIMD batching
 * compared to 4-record batching and single-record processing.
 *
 * Run with:
 *   deno bench --allow-read --allow-ffi bench/Simd8WayBatching.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../src/wasm/mod.ts";

// Initialise WASM
const wasmInitialised = await initWasmActivation();
if (!wasmInitialised || !isWasmActivationAvailable()) {
  console.error("Failed to initialise WASM module.");
  Deno.exit(1);
}

/**
 * Create a benchmark creature
 */
function createBenchmarkCreature(
  numInputs: number,
  numHiddenLayers: number,
  neuronsPerLayer: number,
  numOutputs: number,
  seed: number = 42,
): Creature {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const squashes = ["ReLU", "TANH", "LOGISTIC", "SELU", "GELU"];
  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  let currentIndex = numInputs;

  // Create hidden layers
  for (let layer = 0; layer < numHiddenLayers; layer++) {
    for (let n = 0; n < neuronsPerLayer; n++) {
      const squash = squashes[Math.floor(random() * squashes.length)];
      neurons.push({
        type: "hidden",
        index: currentIndex,
        bias: random() * 2 - 1,
        squash,
      });
      currentIndex++;
    }
  }

  // Create output neurons
  for (let o = 0; o < numOutputs; o++) {
    neurons.push({
      type: "output",
      index: currentIndex,
      bias: random() * 0.5 - 0.25,
      squash: "LOGISTIC",
    });
    currentIndex++;
  }

  // Connect inputs to first hidden layer
  const firstLayerStart = numInputs;
  const firstLayerEnd = numInputs + neuronsPerLayer;
  for (let i = 0; i < numInputs; i++) {
    for (let h = firstLayerStart; h < firstLayerEnd; h++) {
      if (random() > 0.3) {
        synapses.push({
          from: i,
          to: h,
          weight: random() * 2 - 1,
        });
      }
    }
  }

  // Connect hidden layers
  for (let layer = 0; layer < numHiddenLayers - 1; layer++) {
    const layerStart = numInputs + layer * neuronsPerLayer;
    const layerEnd = layerStart + neuronsPerLayer;
    const nextLayerStart = layerEnd;
    const nextLayerEnd = nextLayerStart + neuronsPerLayer;

    for (let from = layerStart; from < layerEnd; from++) {
      for (let to = nextLayerStart; to < nextLayerEnd; to++) {
        if (random() > 0.5) {
          synapses.push({
            from,
            to,
            weight: random() * 2 - 1,
          });
        }
      }
    }
  }

  // Connect last hidden layer to outputs
  const lastLayerStart = numInputs + (numHiddenLayers - 1) * neuronsPerLayer;
  const lastLayerEnd = lastLayerStart + neuronsPerLayer;
  const outputStart = numInputs + numHiddenLayers * neuronsPerLayer;

  for (let h = lastLayerStart; h < lastLayerEnd; h++) {
    for (let o = 0; o < numOutputs; o++) {
      if (random() > 0.2) {
        synapses.push({
          from: h,
          to: outputStart + o,
          weight: random() * 2 - 1,
        });
      }
    }
  }

  const creatureJson: CreatureInternal = {
    neurons,
    synapses,
    input: numInputs,
    output: numOutputs,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.fix();
  creature.clearState();
  return creature;
}

/**
 * Generate packed records for batch processing
 */
function generatePackedRecords(
  inputSize: number,
  outputSize: number,
  numRecords: number,
  seed: number = 42,
): Float32Array {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const valuesPerRecord = inputSize + outputSize;
  const records = new Float32Array(numRecords * valuesPerRecord);

  for (let i = 0; i < numRecords; i++) {
    const base = i * valuesPerRecord;
    for (let j = 0; j < inputSize; j++) {
      records[base + j] = random() * 2 - 1;
    }
    for (let j = 0; j < outputSize; j++) {
      records[base + inputSize + j] = random();
    }
  }

  return records;
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1209: SIMD 8-Way Batching Performance Benchmark");
console.log("=".repeat(70));

// Create benchmark creatures of different sizes
const configs = [
  { name: "Small", inputs: 10, layers: 2, neurons: 20, outputs: 5 },
  { name: "Medium", inputs: 20, layers: 3, neurons: 40, outputs: 10 },
  { name: "Large", inputs: 50, layers: 4, neurons: 80, outputs: 20 },
];

// Record counts to test 8-way, 4-way, and scalar paths
const recordCounts = [256, 1024, 4096];

// Store WASM activations and records for benchmarks
const benchmarkSetups: Array<{
  name: string;
  wasmActivation: WasmCreatureActivation;
  records: Float32Array;
  inputSize: number;
  numRecords: number;
}> = [];

for (const config of configs) {
  const creature = createBenchmarkCreature(
    config.inputs,
    config.layers,
    config.neurons,
    config.outputs,
  );

  const compiled = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiled);

  if (!wasmActivation) {
    console.error(`Failed to create WASM activation for ${config.name}`);
    continue;
  }

  console.log(`\n${config.name} Network:`);
  console.log(`  Neurons: ${creature.neurons.length}`);
  console.log(`  Synapses: ${creature.synapses.length}`);

  for (const numRecords of recordCounts) {
    const records = generatePackedRecords(
      config.inputs,
      config.outputs,
      numRecords,
    );

    benchmarkSetups.push({
      name: config.name,
      wasmActivation,
      records,
      inputSize: config.inputs,
      numRecords,
    });
  }
}

// Register all benchmarks
for (const setup of benchmarkSetups) {
  const { name, wasmActivation, records, inputSize, numRecords } = setup;

  // MSE benchmark (uses 8-way batching)
  Deno.bench({
    name: `${name}: MSE ${numRecords} records`,
    group: `${name.toLowerCase()}-mse`,
    baseline: numRecords === recordCounts[0],
  }, () => {
    wasmActivation.mseSumBatchPacked(records, inputSize, true);
  });

  // MAE benchmark
  Deno.bench({
    name: `${name}: MAE ${numRecords} records`,
    group: `${name.toLowerCase()}-mae`,
    baseline: numRecords === recordCounts[0],
  }, () => {
    wasmActivation.maeSumBatchPacked(records, inputSize, true);
  });

  // Cross-Entropy benchmark
  Deno.bench({
    name: `${name}: Cross-Entropy ${numRecords} records`,
    group: `${name.toLowerCase()}-ce`,
    baseline: numRecords === recordCounts[0],
  }, () => {
    wasmActivation.crossEntropySumBatchPacked(records, inputSize, true);
  });
}

console.log("\n" + "=".repeat(70));
console.log("Benchmarks queued. Running...\n");
