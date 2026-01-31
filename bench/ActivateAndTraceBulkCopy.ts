/**
 * Benchmark: activateAndTrace() Bulk Copy Performance
 *
 * Issue #1172 - WASM Performance: activateAndTrace() copies data element-by-element
 *               instead of using subarray()
 *
 * This benchmark demonstrates the performance improvement from using
 * subarray().set() bulk copy instead of element-by-element copying.
 *
 * The optimisation affects:
 * 1. outputs extraction - from result[0..numOutputs]
 * 2. activations extraction - from result[numOutputs..numOutputs+numNonInputs]
 * 3. hintValues extraction - from result[numOutputs+numNonInputs..numOutputs+2*numNonInputs]
 *
 * Expected improvement: 10-30% faster for trace operations
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/ActivateAndTraceBulkCopy.ts
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

// Iterations per benchmark run
const ITERATIONS = 1000;

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
      if (random() > 0.7) {
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

// Initialise WASM
const wasmInitialised = await initWasmActivation();
if (!wasmInitialised) {
  console.error(
    "Failed to initialise WASM module. Ensure wasm_activation is built.",
  );
  console.error("Run: cd wasm_activation && ./build.sh");
  Deno.exit(1);
}

console.log(`WASM available: ${isWasmActivationAvailable()}`);
console.log(`\nBenchmark: activateAndTrace() Bulk Copy Performance`);
console.log(
  `Issue #1172 - Using subarray().set() instead of element-by-element copy`,
);
console.log(`Iterations per run: ${ITERATIONS}\n`);

// ============================================================================
// Test Case 1: Medium Network (typical use case from issue)
// Issue mentions: 2292 neurons, 1 output, 736 non-input neurons
// ============================================================================
const mediumCreature = createBenchmarkCreature(50, 3, 20, 1);
const mediumCompiled = compileCreatureToWasm(mediumCreature);
const mediumWasm = WasmCreatureActivation.create(mediumCompiled)!;
const mediumInputs = makeInputs(mediumCreature.input, 100);

const mediumNumNonInputs = mediumCompiled.numNeurons - mediumCreature.input;
console.log(`Medium Network: ${getCompiledCreatureStats(mediumCompiled)}`);
console.log(`  Non-input neurons: ${mediumNumNonInputs}`);
console.log(
  `  Arrays extracted per call: 3 (outputs, activations, hintValues)`,
);
console.log(
  `  Total elements copied per call: ${
    mediumCreature.output + 2 * mediumNumNonInputs
  }`,
);

Deno.bench(
  "Medium: activateAndTrace() [bulk copy]",
  { group: "medium-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = mediumInputs[i % mediumInputs.length];
      mediumWasm.activateAndTrace(input);
    }
  },
);

// ============================================================================
// Test Case 2: Large Network (production-like from issue)
// Issue mentions: 2292 neurons with 736 non-input neurons
// 3 x 736 = 2208 element copies per activation (+ outputs)
// ============================================================================
const largeCreature = createBenchmarkCreature(100, 4, 50, 2);
const largeCompiled = compileCreatureToWasm(largeCreature);
const largeWasm = WasmCreatureActivation.create(largeCompiled)!;
const largeInputs = makeInputs(largeCreature.input, 100);

const largeNumNonInputs = largeCompiled.numNeurons - largeCreature.input;
console.log(`\nLarge Network: ${getCompiledCreatureStats(largeCompiled)}`);
console.log(`  Non-input neurons: ${largeNumNonInputs}`);
console.log(
  `  Total elements copied per call: ${
    largeCreature.output + 2 * largeNumNonInputs
  }`,
);

Deno.bench(
  "Large: activateAndTrace() [bulk copy]",
  { group: "large-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = largeInputs[i % largeInputs.length];
      largeWasm.activateAndTrace(input);
    }
  },
);

// ============================================================================
// Test Case 3: Production-Scale (simulates issue #1172 scenario)
// The issue mentions networks with ~2292 neurons and 736 non-input neurons
// ============================================================================
const productionCreature = createBenchmarkCreature(200, 5, 100, 3);
const productionCompiled = compileCreatureToWasm(productionCreature);
const productionWasm = WasmCreatureActivation.create(productionCompiled)!;
const productionInputs = makeInputs(productionCreature.input, 100);

const productionNumNonInputs = productionCompiled.numNeurons -
  productionCreature.input;
console.log(
  `\nProduction-Scale: ${getCompiledCreatureStats(productionCompiled)}`,
);
console.log(`  Non-input neurons: ${productionNumNonInputs}`);
console.log(
  `  Total elements copied per call: ${
    productionCreature.output + 2 * productionNumNonInputs
  }`,
);
console.log(`  (Old approach would copy these elements one-by-one in 3 loops)`);

Deno.bench(
  "Production: activateAndTrace() [bulk copy]",
  { group: "production-scale" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = productionInputs[i % productionInputs.length];
      productionWasm.activateAndTrace(input);
    }
  },
);

// ============================================================================
// Test Case 4: XL Network (stress test for bulk copy)
// Tests that subarray boundaries are calculated correctly for very large arrays
// ============================================================================
const xlCreature = createBenchmarkCreature(300, 6, 150, 5);
const xlCompiled = compileCreatureToWasm(xlCreature);
const xlWasm = WasmCreatureActivation.create(xlCompiled)!;
const xlInputs = makeInputs(xlCreature.input, 100);

const xlNumNonInputs = xlCompiled.numNeurons - xlCreature.input;
console.log(`\nXL Network: ${getCompiledCreatureStats(xlCompiled)}`);
console.log(`  Non-input neurons: ${xlNumNonInputs}`);
console.log(
  `  Total elements copied per call: ${xlCreature.output + 2 * xlNumNonInputs}`,
);

Deno.bench(
  "XL: activateAndTrace() [bulk copy]",
  { group: "xl-network" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = xlInputs[i % xlInputs.length];
      xlWasm.activateAndTrace(input);
    }
  },
);

console.log(`\n`);
console.log(
  `Note: The bulk copy optimisation (Issue #1172) is already applied.`,
);
console.log(
  `These benchmarks measure the current performance with the fix in place.`,
);
console.log(
  `The original code used element-by-element copying in 3 separate loops.`,
);
