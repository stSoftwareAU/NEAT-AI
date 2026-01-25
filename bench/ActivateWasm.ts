/**
 * WASM vs JS Activation Benchmark
 *
 * Issue #1116 - WASM prototype for creature activation
 *
 * This benchmark compares:
 * 1. JS activation (dynamically generated function with hardcoded weights)
 * 2. WASM activation (Rust-compiled WebAssembly)
 * 3. WASM batch activation (multiple inputs in single WASM call)
 *
 * Run with:
 *   deno bench --allow-read bench/ActivateWasm.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  getCompiledCreatureStats,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../src/wasm/mod.ts";

// Number of iterations per benchmark run
const ITERATIONS = 1000;

// Supported squash functions for WASM (standard squash functions only)
const SUPPORTED_SQUASHES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "SELU",
  "ELU",
  "LeakyReLU",
  "Softplus",
  "Swish",
  "Mish",
  "GELU",
  "IDENTITY",
  "HARD_TANH",
  "SOFTSIGN",
  "GAUSSIAN",
  "BENT_IDENTITY",
  "BIPOLAR_SIGMOID",
  "BIPOLAR",
  "STEP",
  "SINE",
  "Cosine",
  "TAN",
  "ArcTan",
  "ABSOLUTE",
  "SQUARE",
  "Cube",
];

/**
 * Create a synthetic creature with only WASM-supported squash functions
 * This generates a moderately complex network for benchmarking
 */
function createBenchmarkCreature(
  numInputs: number,
  numHidden: number,
  numOutputs: number,
): Creature {
  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  // Add hidden neurons with random supported squash functions
  for (let i = 0; i < numHidden; i++) {
    const squash =
      SUPPORTED_SQUASHES[Math.floor(Math.random() * SUPPORTED_SQUASHES.length)];
    const bias = Math.random() * 2 - 1;
    neurons.push({
      type: "hidden",
      index: numInputs + i,
      bias,
      squash,
    });
  }

  // Add output neurons
  for (let i = 0; i < numOutputs; i++) {
    const squash =
      SUPPORTED_SQUASHES[Math.floor(Math.random() * SUPPORTED_SQUASHES.length)];
    const bias = Math.random() * 2 - 1;
    neurons.push({
      type: "output",
      index: numInputs + numHidden + i,
      bias,
      squash,
    });
  }

  // Connect inputs to first hidden layer (every input to every hidden)
  for (let i = 0; i < numInputs; i++) {
    for (let h = 0; h < Math.min(numHidden, 10); h++) {
      const weight = Math.random() * 2 - 1;
      synapses.push({
        from: i,
        to: numInputs + h,
        weight,
      });
    }
  }

  // Connect hidden neurons in layers (roughly)
  const layerSize = Math.ceil(numHidden / 5);
  for (let layer = 0; layer < 4; layer++) {
    const layerStart = layer * layerSize;
    const layerEnd = Math.min(layerStart + layerSize, numHidden);
    const nextLayerStart = layerEnd;
    const nextLayerEnd = Math.min(nextLayerStart + layerSize, numHidden);

    for (let from = layerStart; from < layerEnd; from++) {
      for (
        let to = nextLayerStart;
        to < nextLayerEnd && to < numHidden;
        to++
      ) {
        const weight = Math.random() * 2 - 1;
        synapses.push({
          from: numInputs + from,
          to: numInputs + to,
          weight,
        });
      }
    }
  }

  // Connect last hidden layer to outputs
  const lastLayerStart = Math.max(0, numHidden - layerSize);
  for (let h = lastLayerStart; h < numHidden; h++) {
    for (let o = 0; o < numOutputs; o++) {
      const weight = Math.random() * 2 - 1;
      synapses.push({
        from: numInputs + h,
        to: numInputs + numHidden + o,
        weight,
      });
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

// Create a benchmark creature with supported squash functions
// Using 100 inputs, 200 hidden neurons, 10 outputs
const creature = createBenchmarkCreature(100, 200, 10);

// Generate random inputs
function makeInputs(creature: Creature, count: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = new Float32Array(creature.input);
    for (let y = 0; y < creature.input; y++) {
      data[y] = Math.random() * 4 - 2;
    }
    inputs.push(data);
  }
  return inputs;
}

const inputs = makeInputs(creature, 100);

// Print creature stats
console.log(`\nBenchmark Creature: Synthetic (standard squash functions only)`);
console.log(
  `  Neurons: ${creature.neurons.length} (${creature.input} input, ${creature.output} output)`,
);
console.log(`  Synapses: ${creature.synapses.length}`);

// Get project root for WASM path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM
const wasmInitialised = await initWasmActivation(wasmPath);
if (!wasmInitialised) {
  console.error(
    "Failed to initialise WASM module. Ensure wasm_activation is built.",
  );
  console.error("Run: cd wasm_activation && ./build.sh");
  Deno.exit(1);
}

console.log(`  WASM available: ${isWasmActivationAvailable()}`);

// Compile creature for WASM
const compiled = compileCreatureToWasm(creature);
console.log(`  ${getCompiledCreatureStats(compiled)}`);

// Create WASM activation
const wasmActivation = WasmCreatureActivation.create(compiled);
if (!wasmActivation) {
  console.error("Failed to create WASM activation");
  Deno.exit(1);
}

console.log(`\nBenchmark: ${ITERATIONS} activations per iteration\n`);

// JS Activation benchmark
Deno.bench("JS Activation", { group: "activation" }, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    const input = inputs[i % inputs.length];
    creature.activate(input, false);
  }
});

// WASM Activation benchmark (individual calls)
Deno.bench("WASM Activation", { group: "activation", baseline: true }, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    const input = inputs[i % inputs.length];
    wasmActivation.activate(input);
  }
});

// Cleanup note: WASM resources will be freed when process exits
