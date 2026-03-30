/**
 * Issue #1522 - Persistent Training State in WASM Linear Memory
 *
 * Benchmark comparing:
 * 1. Current approach: JS objects ↔ WASM marshalling per iteration
 * 2. Persistent state: Training state lives in WASM, only read at epoch end
 *
 * The persistent state approach eliminates per-iteration result unpacking
 * (7 field additions per synapse, 3 per neuron) and provides the foundation
 * for the fused backprop loop (#1520) to operate entirely within WASM memory.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/PersistentTrainingState.ts
 */

import { NeuronState } from "@architecture/CreatureState.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SynapseState } from "@propagate/SynapseState.ts";
import { accumulateWeightBatch4Way } from "@propagate/Weight.ts";
import { accumulateBiasBatch4Way } from "@propagate/Bias.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../src/wasm/mod.ts";
import {
  initTrainingState,
  readAllNeuronState,
  readAllSynapseState,
  resetTrainingState,
  wasmAccumulateBiasPersistent4Way,
  wasmAccumulateWeightPersistent4Way,
} from "../src/wasm/WasmTrainingState.ts";

// Initialise WASM
const wasmInitialised = await initWasmActivation();
console.log(`WASM available: ${isWasmActivationAvailable()}`);
if (!wasmInitialised) {
  console.warn(
    "WASM not available - benchmarks will measure TS-only performance",
  );
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1522: Persistent Training State Performance Benchmark");
console.log("=".repeat(70));

// Configuration
const config = createBackPropagationConfig({
  generations: 10,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
});

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const NUM_SYNAPSES = 512;
const NUM_NEURONS = 128;
const NUM_ITERATIONS = 100;
const random = seededRandom(42);

// Pre-generate test data for all iterations
const weightData = Array.from({ length: NUM_ITERATIONS }, () => ({
  currentWeights: Array.from({ length: NUM_SYNAPSES }, () => random()),
  targetValues: Array.from({ length: NUM_SYNAPSES }, () => random()),
  activations: Array.from(
    { length: NUM_SYNAPSES },
    () => random() * 0.5 + 0.1,
  ),
}));

const biasData = Array.from({ length: NUM_ITERATIONS }, () => ({
  currentBiases: Array.from({ length: NUM_NEURONS }, () => random() * 0.5),
  targetPreActivations: Array.from({ length: NUM_NEURONS }, () => random()),
  preActivations: Array.from({ length: NUM_NEURONS }, () => random()),
}));

// Pre-allocate reusable slice arrays (avoids .slice() overhead)
const reuseWeight4 = {
  cw: new Array<number>(4),
  tv: new Array<number>(4),
  ac: new Array<number>(4),
};
const reuseBias4 = {
  tp: new Array<number>(4),
  pa: new Array<number>(4),
  cb: new Array<number>(4),
};

// ============================================================================
// WEIGHT ACCUMULATION: Marshalling vs Persistent
// ============================================================================

Deno.bench({
  name: "Weight epoch: JS object marshalling (baseline)",
  group: "weight-epoch",
  baseline: true,
}, () => {
  const states = Array.from({ length: NUM_SYNAPSES }, () => new SynapseState());

  for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
    const data = weightData[iter];
    for (let i = 0; i < NUM_SYNAPSES; i += 4) {
      for (let k = 0; k < 4; k++) {
        reuseWeight4.cw[k] = data.currentWeights[i + k];
        reuseWeight4.tv[k] = data.targetValues[i + k];
        reuseWeight4.ac[k] = data.activations[i + k];
      }
      accumulateWeightBatch4Way(
        reuseWeight4.cw,
        [states[i], states[i + 1], states[i + 2], states[i + 3]],
        reuseWeight4.tv,
        reuseWeight4.ac,
        config,
      );
    }
  }

  // Read results (simulating epoch end)
  let _sum = 0;
  for (const s of states) {
    _sum += s.count;
  }
});

Deno.bench({
  name: "Weight epoch: Persistent WASM state",
  group: "weight-epoch",
}, () => {
  initTrainingState(NUM_SYNAPSES, NUM_NEURONS);

  for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
    const data = weightData[iter];
    for (let i = 0; i < NUM_SYNAPSES; i += 4) {
      for (let k = 0; k < 4; k++) {
        reuseWeight4.cw[k] = data.currentWeights[i + k];
        reuseWeight4.tv[k] = data.targetValues[i + k];
        reuseWeight4.ac[k] = data.activations[i + k];
      }
      wasmAccumulateWeightPersistent4Way(
        i,
        reuseWeight4.cw,
        reuseWeight4.tv,
        reuseWeight4.ac,
        config,
      );
    }
  }

  // Bulk read at epoch end — single WASM call
  readAllSynapseState();
  resetTrainingState();
});

// ============================================================================
// BIAS ACCUMULATION: Marshalling vs Persistent
// ============================================================================

Deno.bench({
  name: "Bias epoch: JS object marshalling (baseline)",
  group: "bias-epoch",
  baseline: true,
}, () => {
  const states = Array.from({ length: NUM_NEURONS }, () => new NeuronState());

  for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
    const data = biasData[iter];
    for (let i = 0; i < NUM_NEURONS; i += 4) {
      for (let k = 0; k < 4; k++) {
        reuseBias4.tp[k] = data.targetPreActivations[i + k];
        reuseBias4.pa[k] = data.preActivations[i + k];
        reuseBias4.cb[k] = data.currentBiases[i + k];
      }
      accumulateBiasBatch4Way(
        [states[i], states[i + 1], states[i + 2], states[i + 3]],
        reuseBias4.tp,
        reuseBias4.pa,
        reuseBias4.cb,
        config,
      );
    }
  }

  let _sum = 0;
  for (const s of states) {
    _sum += s.count;
  }
});

Deno.bench({
  name: "Bias epoch: Persistent WASM state",
  group: "bias-epoch",
}, () => {
  initTrainingState(NUM_SYNAPSES, NUM_NEURONS);

  for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
    const data = biasData[iter];
    for (let i = 0; i < NUM_NEURONS; i += 4) {
      for (let k = 0; k < 4; k++) {
        reuseBias4.tp[k] = data.targetPreActivations[i + k];
        reuseBias4.pa[k] = data.preActivations[i + k];
        reuseBias4.cb[k] = data.currentBiases[i + k];
      }
      wasmAccumulateBiasPersistent4Way(
        i,
        reuseBias4.tp,
        reuseBias4.pa,
        reuseBias4.cb,
        config,
      );
    }
  }

  readAllNeuronState();
  resetTrainingState();
});

console.log("\n" + "=".repeat(70));
console.log("Benchmarks queued. Running...\n");
console.log(
  "Note: Persistent state eliminates per-iteration JS↔WASM result",
);
console.log("unpacking. Full benefit realised with fused backprop (#1520).");
console.log("=".repeat(70) + "\n");
