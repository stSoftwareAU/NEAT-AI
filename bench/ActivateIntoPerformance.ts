/**
 * Benchmark: activate() vs activate_into() Performance Comparison
 *
 * Issue #1171 - WASM Performance: Per-call Float32Array allocation overhead
 *
 * This benchmark compares:
 * 1. activate() - allocates new Float32Array on every call
 * 2. activateInto() - writes to pre-allocated buffer, zero allocation overhead
 *
 * The expected improvement is 5-15% reduction in activation overhead for
 * high-throughput scoring scenarios (millions of records).
 *
 * Run with:
 *   deno bench --allow-read bench/ActivateIntoPerformance.ts
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

// Iterations per benchmark run - simulates production scoring workload
const ITERATIONS = 10000;

// Supported squash functions for WASM
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
];

/**
 * Create a synthetic creature for benchmarking
 */
function createBenchmarkCreature(
  numInputs: number,
  numHiddenLayers: number,
  neuronsPerLayer: number,
  numOutputs: number,
  seed: number = 42,
): Creature {
  // Simple seeded random for reproducibility
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  let currentIndex = numInputs;

  // Create hidden layers
  for (let layer = 0; layer < numHiddenLayers; layer++) {
    for (let n = 0; n < neuronsPerLayer; n++) {
      const squash = SUPPORTED_SQUASHES[
        Math.floor(random() * SUPPORTED_SQUASHES.length)
      ];
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
      bias: random() * 2 - 1,
      squash: "LOGISTIC",
    });
    currentIndex++;
  }

  // Connect inputs to first hidden layer
  const firstLayerEnd = numInputs + neuronsPerLayer;
  for (let i = 0; i < numInputs; i++) {
    for (let h = numInputs; h < firstLayerEnd; h++) {
      if (random() > 0.7) { // Sparse connectivity
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
      synapses.push({
        from: h,
        to: outputStart + o,
        weight: random() * 2 - 1,
      });
    }
  }

  const json: CreatureInternal = {
    neurons,
    synapses,
    input: numInputs,
    output: numOutputs,
  };

  const creature = Creature.fromJSON(json);
  creature.fix();
  creature.clearState();
  return creature;
}

// Generate random inputs once for consistency
function makeInputs(numInputs: number, count: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = new Float32Array(numInputs);
    for (let j = 0; j < numInputs; j++) {
      data[j] = Math.random() * 4 - 2;
    }
    inputs.push(data);
  }
  return inputs;
}

// ============================================================================
// Benchmark Setup
// ============================================================================

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

console.log(`WASM available: ${isWasmActivationAvailable()}`);
console.log(`Benchmark: ${ITERATIONS} activations per iteration\n`);

// ============================================================================
// Test Case 1: Small Network (minimal overhead case)
// ============================================================================
const smallCreature = createBenchmarkCreature(10, 2, 5, 1);
const smallCompiled = compileCreatureToWasm(smallCreature);
const smallWasm = WasmCreatureActivation.create(smallCompiled)!;
const smallInputs = makeInputs(smallCreature.input, 100);

console.log(`\nSmall Network: ${getCompiledCreatureStats(smallCompiled)}`);

Deno.bench(
  "Small: activate() [allocating]",
  { group: "small-network", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = smallInputs[i % smallInputs.length];
      smallWasm.activate(input);
    }
  },
);

const smallOutputBuffer = new Float32Array(smallCreature.output);
Deno.bench(
  "Small: activateInto() [zero-alloc]",
  { group: "small-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = smallInputs[i % smallInputs.length];
      smallWasm.activateInto(input, smallOutputBuffer);
    }
  },
);

// ============================================================================
// Test Case 2: Medium Network (typical use case)
// ============================================================================
const mediumCreature = createBenchmarkCreature(50, 3, 20, 5);
const mediumCompiled = compileCreatureToWasm(mediumCreature);
const mediumWasm = WasmCreatureActivation.create(mediumCompiled)!;
const mediumInputs = makeInputs(mediumCreature.input, 100);

console.log(`\nMedium Network: ${getCompiledCreatureStats(mediumCompiled)}`);

Deno.bench(
  "Medium: activate() [allocating]",
  { group: "medium-network", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = mediumInputs[i % mediumInputs.length];
      mediumWasm.activate(input);
    }
  },
);

const mediumOutputBuffer = new Float32Array(mediumCreature.output);
Deno.bench(
  "Medium: activateInto() [zero-alloc]",
  { group: "medium-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = mediumInputs[i % mediumInputs.length];
      mediumWasm.activateInto(input, mediumOutputBuffer);
    }
  },
);

// ============================================================================
// Test Case 3: Large Network (production-like)
// ============================================================================
const largeCreature = createBenchmarkCreature(200, 4, 50, 10);
const largeCompiled = compileCreatureToWasm(largeCreature);
const largeWasm = WasmCreatureActivation.create(largeCompiled)!;
const largeInputs = makeInputs(largeCreature.input, 100);

console.log(`\nLarge Network: ${getCompiledCreatureStats(largeCompiled)}`);

Deno.bench(
  "Large: activate() [allocating]",
  { group: "large-network", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = largeInputs[i % largeInputs.length];
      largeWasm.activate(input);
    }
  },
);

const largeOutputBuffer = new Float32Array(largeCreature.output);
Deno.bench(
  "Large: activateInto() [zero-alloc]",
  { group: "large-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = largeInputs[i % largeInputs.length];
      largeWasm.activateInto(input, largeOutputBuffer);
    }
  },
);

// ============================================================================
// Test Case 4: Production-Scale (simulates production creature workload)
// Issue mentions: 1556 inputs, 1 output, scoring 2,160,230 records
// ============================================================================
const productionCreature = createBenchmarkCreature(500, 3, 30, 1);
const productionCompiled = compileCreatureToWasm(productionCreature);
const productionWasm = WasmCreatureActivation.create(productionCompiled)!;
const productionInputs = makeInputs(productionCreature.input, 100);

console.log(
  `\nProduction-Scale: ${getCompiledCreatureStats(productionCompiled)}`,
);

Deno.bench(
  "Production: activate() [allocating]",
  { group: "production-scale", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = productionInputs[i % productionInputs.length];
      productionWasm.activate(input);
    }
  },
);

const productionOutputBuffer = new Float32Array(productionCreature.output);
Deno.bench(
  "Production: activateInto() [zero-alloc]",
  { group: "production-scale" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = productionInputs[i % productionInputs.length];
      productionWasm.activateInto(input, productionOutputBuffer);
    }
  },
);

// ============================================================================
// Test Case 5: Multiple Outputs (higher allocation overhead per call)
// ============================================================================
const multiOutputCreature = createBenchmarkCreature(100, 3, 30, 20);
const multiOutputCompiled = compileCreatureToWasm(multiOutputCreature);
const multiOutputWasm = WasmCreatureActivation.create(multiOutputCompiled)!;
const multiOutputInputs = makeInputs(multiOutputCreature.input, 100);

console.log(
  `\nMulti-Output (20 outputs): ${
    getCompiledCreatureStats(multiOutputCompiled)
  }`,
);

Deno.bench(
  "Multi-Output: activate() [allocating]",
  { group: "multi-output", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = multiOutputInputs[i % multiOutputInputs.length];
      multiOutputWasm.activate(input);
    }
  },
);

const multiOutputBuffer = new Float32Array(multiOutputCreature.output);
Deno.bench(
  "Multi-Output: activateInto() [zero-alloc]",
  { group: "multi-output" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = multiOutputInputs[i % multiOutputInputs.length];
      multiOutputWasm.activateInto(input, multiOutputBuffer);
    }
  },
);

console.log(`\n`);
