/**
 * Issue #3477 - Benchmark: pooled / inlined weight accumulation in
 * `propagateUpdate`.
 *
 * `propagateUpdate` runs once per non-input neuron at the end of every training
 * iteration (via `applyLearnings`). The old implementation allocated three
 * growable `number[]` arrays per neuron (`currentWeights`, `candidateWeights`,
 * `sourceActivations`) grown with `push()`. Issue #3477:
 *   - Coordination disabled (`biasWeightCoordinationFactor >= 1`): candidates
 *     are applied inline — zero scratch arrays.
 *   - Coordination enabled (`< 1`): the three arrays are reused from the shared
 *     `state.backpropBuffers` pool instead of being reallocated per neuron.
 *
 * This bench drives a full training step (activateAndTrace + propagate +
 * applyLearnings) on a wide-fan-in production-scale creature, so `propagateUpdate`
 * is exercised for every neuron every iteration. Run the same file on the
 * pre-change and post-change trees for before/after evidence.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-write --allow-ffi \
 *     bench/PropagateUpdatePooling.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(3477);

const SQUASH_NAMES = ["ReLU", "TANH", "LOGISTIC", "GELU", "LeakyReLU"];

/**
 * Build a densely connected feed-forward network so `propagateUpdate` sees a
 * large per-neuron fan-in — the case the per-neuron array allocation hurt most.
 */
function buildNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerUUIDs: string[][] = [];

  const inputUUIDs = Array.from({ length: inputCount }, (_, i) => `input-${i}`);
  layerUUIDs.push(inputUUIDs);

  for (let l = 0; l < hiddenLayers.length; l++) {
    const uuids: string[] = [];
    for (let i = 0; i < hiddenLayers[l]; i++) {
      const uuid = `hidden-${l}-${i}`;
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

  // Dense connectivity between adjacent layers → high fan-in per neuron.
  for (let l = 0; l < layerUUIDs.length - 1; l++) {
    for (const fromUUID of layerUUIDs[l]) {
      for (const toUUID of layerUUIDs[l + 1]) {
        synapses.push({ fromUUID, toUUID, weight: random() * 0.5 });
      }
    }
  }

  return { input: inputCount, output: outputCount, neurons, synapses };
}

const json = buildNetwork(12, 4, [80, 80, 60]);
const totalNeurons = json.neurons.length + json.input;
const totalSynapses = json.synapses.length;
console.log(`Network: ${totalNeurons}N / ${totalSynapses}S (dense fan-in)`);

const input = new Float32Array(
  Array.from({ length: 12 }, () => random() * 0.5 + 0.5),
);
const target = new Float32Array(
  Array.from({ length: 4 }, () => random() * 0.5),
);

function makeConfig(coordinationFactor: number) {
  return createBackPropagationConfig({
    generations: 5,
    learningRate: 0.01,
    plankConstant: 0.000_000_1,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 8,
    biasWeightCoordinationFactor: coordinationFactor,
  });
}

// Coordination disabled — the pure-inline path (no scratch arrays).
const disabledConfig = makeConfig(1);
const disabledCreature = Creature.fromJSON(json);
const disabledSparse = new SparseConfig(
  disabledCreature.exportJSON(),
  disabledConfig,
);

Deno.bench({
  name:
    `Training step - coordination disabled (${totalNeurons}N/${totalSynapses}S)`,
  group: "training-step",
  baseline: true,
}, () => {
  disabledCreature.activateAndTrace(input, false, disabledSparse);
  disabledCreature.propagate(target, disabledConfig, disabledSparse);
  disabledCreature.applyLearnings(disabledConfig, disabledSparse);
});

// Coordination enabled — the pooled-scratch path (default production setting).
const enabledConfig = makeConfig(0.2);
const enabledCreature = Creature.fromJSON(json);
const enabledSparse = new SparseConfig(
  enabledCreature.exportJSON(),
  enabledConfig,
);

Deno.bench({
  name:
    `Training step - coordination enabled (${totalNeurons}N/${totalSynapses}S)`,
  group: "training-step",
}, () => {
  enabledCreature.activateAndTrace(input, false, enabledSparse);
  enabledCreature.propagate(target, enabledConfig, enabledSparse);
  enabledCreature.applyLearnings(enabledConfig, enabledSparse);
});

// ---------------------------------------------------------------------------
// Isolated allocation head-to-head for the coordination-disabled path: the old
// code allocated three growable number[] per neuron (grown with push()); the new
// code applies each candidate inline with no scratch arrays. Same-process ratio,
// independent of machine load.
// ---------------------------------------------------------------------------
const NEURONS = 240;
const FAN_IN = 52; // representative dense fan-in
const scratchWeights = new Float64Array(NEURONS * FAN_IN);
for (let i = 0; i < scratchWeights.length; i++) scratchWeights[i] = random();

Deno.bench({
  name:
    `propagateUpdate accumulation - 3 arrays/neuron (${NEURONS}N x${FAN_IN})`,
  group: "propagate-update-accumulation",
  baseline: true,
}, () => {
  let sink = 0;
  for (let n = 0; n < NEURONS; n++) {
    const currentWeights: number[] = [];
    const candidateWeights: number[] = [];
    const sourceActivations: number[] = [];
    const base = n * FAN_IN;
    for (let i = 0; i < FAN_IN; i++) {
      const w = scratchWeights[base + i];
      currentWeights.push(w);
      candidateWeights.push(w * 0.99);
      sourceActivations.push(w * 0.5);
    }
    for (let i = 0; i < FAN_IN; i++) sink += candidateWeights[i];
  }
  if (!Number.isFinite(sink)) throw new Error("unreachable");
});

Deno.bench({
  name:
    `propagateUpdate accumulation - inline, no arrays (${NEURONS}N x${FAN_IN})`,
  group: "propagate-update-accumulation",
}, () => {
  let sink = 0;
  for (let n = 0; n < NEURONS; n++) {
    const base = n * FAN_IN;
    for (let i = 0; i < FAN_IN; i++) {
      sink += scratchWeights[base + i] * 0.99;
    }
  }
  if (!Number.isFinite(sink)) throw new Error("unreachable");
});

console.log("\n" + "=".repeat(70));
console.log(
  "Issue #3477: pooled / inlined propagateUpdate weight accumulation",
);
console.log("=".repeat(70));
console.log("Lower is better.\n");
