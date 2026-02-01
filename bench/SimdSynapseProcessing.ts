/**
 * Issue #1178 - SIMD Synapse Processing Benchmark
 *
 * Measures WASM activation performance with different network sizes and
 * synapse densities, exercising the SIMD-optimised weighted sum paths
 * including the dual-accumulator approach.
 *
 * The SIMD optimisations in this issue include:
 * - Dual-accumulator weighted sum (processes 8 synapses per iteration)
 * - SIMD aggregate helpers (sum-of-squares for Hypotenuse, no-bias sum for Mean)
 *
 * Run with:
 *   deno bench --allow-read --allow-ffi bench/SimdSynapseProcessing.ts
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

// Initialise WASM
const wasmInitialised = await initWasmActivation();
if (!wasmInitialised || !isWasmActivationAvailable()) {
  console.error("Failed to initialise WASM module.");
  Deno.exit(1);
}

/** Deterministic PRNG for reproducible benchmarks */
function makePrng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Create a creature with a specific squash function distribution.
 * Uses standard (non-aggregate) squash functions.
 */
function createCreature(
  numInputs: number,
  numHidden: number,
  numOutputs: number,
  synapsesPerNeuron: number,
  squashes: string[],
  seed: number = 42,
): Creature {
  const random = makePrng(seed);

  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  // Hidden neurons
  for (let i = 0; i < numHidden; i++) {
    neurons.push({
      type: "hidden",
      index: numInputs + i,
      bias: random() * 2 - 1,
      squash: squashes[Math.floor(random() * squashes.length)],
    });
  }

  // Output neurons
  for (let i = 0; i < numOutputs; i++) {
    neurons.push({
      type: "output",
      index: numInputs + numHidden + i,
      bias: random() * 2 - 1,
      squash: "IDENTITY",
    });
  }

  // Dense connections: each hidden neuron connects to synapsesPerNeuron source neurons
  for (let h = 0; h < numHidden; h++) {
    const to = numInputs + h;
    const numConnections = Math.min(synapsesPerNeuron, numInputs + h);
    for (let c = 0; c < numConnections; c++) {
      const from = Math.floor(random() * (numInputs + h));
      if (from !== to) {
        synapses.push({ from, to, weight: random() * 2 - 1 });
      }
    }
  }

  // Output connections
  for (let o = 0; o < numOutputs; o++) {
    const to = numInputs + numHidden + o;
    for (let h = 0; h < Math.min(10, numHidden); h++) {
      synapses.push({
        from: numInputs + h,
        to,
        weight: random() * 2 - 1,
      });
    }
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: numInputs,
    output: numOutputs,
  });
  creature.fix();
  creature.clearState();
  return creature;
}

/** Create WASM activation from a creature */
function makeWasm(creature: Creature): WasmCreatureActivation {
  const compiled = compileCreatureToWasm(creature);
  const wasm = WasmCreatureActivation.create(compiled);
  if (!wasm) throw new Error("Failed to create WASM activation");
  return wasm;
}

/** Generate random input data */
function makeInputs(numInputs: number, count: number): Float32Array[] {
  const random = makePrng(123);
  return Array.from({ length: count }, () => {
    const data = new Float32Array(numInputs);
    for (let i = 0; i < numInputs; i++) data[i] = random() * 4 - 2;
    return data;
  });
}

const STANDARD_SQUASHES = ["ReLU", "TANH", "LOGISTIC", "IDENTITY"];

// --- Small network: ~5 synapses/neuron (exercises scalar fallback) ---
const smallCreature = createCreature(20, 50, 5, 5, STANDARD_SQUASHES, 42);
const smallWasm = makeWasm(smallCreature);
const smallInputs = makeInputs(20, 50);

console.log("\n=== Issue #1178: SIMD Synapse Processing Benchmark ===");
console.log(
  `Small network: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `  ${getCompiledCreatureStats(compileCreatureToWasm(smallCreature))}`,
);

// --- Medium network: ~25 synapses/neuron (exercises SIMD dual-accumulator) ---
const medCreature = createCreature(100, 200, 10, 25, STANDARD_SQUASHES, 99);
const medWasm = makeWasm(medCreature);
const medInputs = makeInputs(100, 50);

console.log(
  `Medium network: ${medCreature.neurons.length} neurons, ${medCreature.synapses.length} synapses`,
);
console.log(
  `  ${getCompiledCreatureStats(compileCreatureToWasm(medCreature))}`,
);

// --- Large production-like network: ~25 synapses/neuron, 736 hidden ---
const largeCreature = createCreature(200, 736, 20, 25, STANDARD_SQUASHES, 77);
const largeWasm = makeWasm(largeCreature);
const largeInputs = makeInputs(200, 50);

console.log(
  `Large network: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);
console.log(
  `  ${getCompiledCreatureStats(compileCreatureToWasm(largeCreature))}\n`,
);

const ITERATIONS = 500;

// Benchmark groups
Deno.bench(
  "Small (5 syn/neuron, scalar path)",
  { group: "synapse-processing", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      smallWasm.activate(smallInputs[i % smallInputs.length]);
    }
  },
);

Deno.bench("Medium (25 syn/neuron, SIMD dual-acc)", {
  group: "synapse-processing",
}, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    medWasm.activate(medInputs[i % medInputs.length]);
  }
});

Deno.bench("Large (25 syn/neuron, 736 hidden)", {
  group: "synapse-processing",
}, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    largeWasm.activate(largeInputs[i % largeInputs.length]);
  }
});

// activateInto comparison (zero-alloc path)
const medOutput = new Float32Array(10);
Deno.bench(
  "Medium activateInto (zero-alloc)",
  { group: "activate-into", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      medWasm.activateInto(medInputs[i % medInputs.length], medOutput);
    }
  },
);

const largeOutput = new Float32Array(20);
Deno.bench(
  "Large activateInto (zero-alloc)",
  { group: "activate-into" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      largeWasm.activateInto(largeInputs[i % largeInputs.length], largeOutput);
    }
  },
);
