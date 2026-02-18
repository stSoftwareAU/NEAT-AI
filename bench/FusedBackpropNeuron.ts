/**
 * Issue #1520 - Benchmark: Fused backprop inner loop vs separate calls.
 *
 * Compares the performance of:
 * 1. Separate calls: N × accumulateWeight + 1 × accumulateBias (TS)
 * 2. Fused WASM: single wasmFusedBackpropNeuron call
 *
 * The fused approach eliminates N+1 WASM/TS boundary crossings per neuron
 * by combining weight and bias accumulation into a single WASM call.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/FusedBackpropNeuron.ts
 */

import {
  ensureWasmActivation,
  isWasmActivationAvailable,
} from "../src/wasm/mod.ts";
import { wasmFusedBackpropNeuron } from "../src/wasm/WasmStandaloneFunctions.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { accumulateWeight } from "../src/propagate/Weight.ts";
import { accumulateBias } from "../src/propagate/Bias.ts";
import { SynapseState } from "../src/propagate/SynapseState.ts";
import { NeuronState } from "../src/architecture/CreatureState.ts";

await ensureWasmActivation();
console.log(`WASM available: ${isWasmActivationAvailable()}`);

const config = createBackPropagationConfig({
  learningRate: 0.5,
  maximumWeightAdjustmentScale: 2.0,
  limitWeightScale: 100000,
  plankConstant: 1e-7,
  maximumBiasAdjustmentScale: 1.0,
  limitBiasScale: 10000,
  generations: 5,
});

/** Seeded random for reproducibility. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(42);

// Generate test data for various synapse counts
function generateData(n: number) {
  const weights = new Float64Array(n);
  const targets = new Float64Array(n);
  const acts = new Float64Array(n);
  const rawWeights: number[] = [];
  for (let i = 0; i < n; i++) {
    weights[i] = random() * 2;
    targets[i] = random() * 5;
    acts[i] = random();
    rawWeights.push(weights[i]);
  }
  return { weights, targets, acts, rawWeights };
}

// Pre-generate test data
const sizes = [10, 50, 200, 1000];
const testData = new Map<number, ReturnType<typeof generateData>>();
for (const s of sizes) {
  testData.set(s, generateData(s));
}

console.log(
  "\n--- Comparing separate TS calls vs fused WASM call ---\n",
);

for (const size of sizes) {
  const data = testData.get(size)!;

  // Benchmark: Separate TS calls (N × accumulateWeight + 1 × accumulateBias)
  Deno.bench({
    name: `Separate TS (${size} synapses)`,
    group: `backprop-${size}`,
    baseline: true,
  }, () => {
    const synapseStates: SynapseState[] = [];
    for (let i = 0; i < size; i++) {
      synapseStates.push(new SynapseState());
    }

    for (let i = 0; i < size; i++) {
      accumulateWeight(
        data.rawWeights[i],
        synapseStates[i],
        data.targets[i],
        data.acts[i],
        config,
      );
    }

    const ns = new NeuronState();

    accumulateBias(ns, 5.0, 3.0, 0.7, config);
  });

  // Benchmark: Fused WASM call
  Deno.bench({
    name: `Fused WASM (${size} synapses)`,
    group: `backprop-${size}`,
  }, () => {
    wasmFusedBackpropNeuron(
      data.weights,
      data.targets,
      data.acts,
      config,
      5.0, // targetPreActivation
      3.0, // preActivation
      0.7, // currentBias
    );
  });
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1520: Fused Backprop Inner Loop Benchmark");
console.log("=".repeat(70));
console.log(
  "Comparing N separate TS accumulateWeight calls + 1 accumulateBias",
);
console.log("vs 1 fused WASM call for all weight + bias accumulation.");
console.log("Lower is better.\n");
