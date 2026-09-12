/**
 * A production-scale creature for the instrumentation benchmarks.
 *
 * Shared by `bench/EvaluationArchiveOverhead.ts` (Issue #3929) and
 * `bench/TrainingGainLogOverhead.ts` (Issue #3934): both measure what an
 * observer costs against the thing it observes, and both are only honest at the
 * GRQ lineage's working size — ~5,300 neurons, and **denser** than that lineage's
 * ~39,000 synapses: the layer shape and fan-out below produce ~87,000, so an
 * overhead budget asserted against it is conservative rather than flattering.
 * Two private copies of this builder would let the two benches quietly measure
 * different creatures and report their overheads as comparable.
 *
 * Not a benchmark itself: it declares no `Deno.bench`.
 *
 * @module _productionScaleCreature
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/** Seeded generator so the topology is identical on every run. */
export function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];

/** A sparse forward-only network of the requested layer shape. */
export function buildNetwork(
  random: () => number,
  inputCount: number,
  outputCount: number,
  hiddenLayers: readonly number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerUUIDs: string[][] = [
    Array.from({ length: inputCount }, (_, i) => `input-${i}`),
  ];

  hiddenLayers.forEach((layerSize, layerIdx) => {
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
  });

  const outputUUIDs: string[] = [];
  for (let i = 0; i < outputCount; i++) {
    const uuid = `output-${i}`;
    outputUUIDs.push(uuid);
    neurons.push({ type: "output", uuid, squash: "IDENTITY", bias: random() });
  }
  layerUUIDs.push(outputUUIDs);

  for (let l = 0; l < layerUUIDs.length - 1; l++) {
    const toLayer = layerUUIDs[l + 1];
    for (const fromUUID of layerUUIDs[l]) {
      const fanOut = Math.min(maxFanOut, toLayer.length);
      const connected = new Set<number>();
      while (connected.size < fanOut) {
        const targetIdx = Math.floor(Math.abs(random()) * toLayer.length);
        if (connected.has(targetIdx)) continue;
        connected.add(targetIdx);
        synapses.push({
          fromUUID,
          toUUID: toLayer[targetIdx],
          weight: random() * 0.5,
        });
      }
    }
  }

  return { input: inputCount, output: outputCount, neurons, synapses };
}

/** ~5,300 neurons, the GRQ lineage's working size. */
export const HIDDEN_LAYERS: readonly number[] = Object.freeze([
  900,
  1100,
  1100,
  900,
  700,
  588,
]);
/** Inputs of the GRQ-shaped creature. */
export const INPUT_COUNT = 8;
/** Outputs of the GRQ-shaped creature. */
export const OUTPUT_COUNT = 4;
/** Synapses each neuron emits into the next layer. */
export const MAX_FAN_OUT = 18;

/**
 * One GRQ-shaped creature with its UUID derived.
 *
 * @param seed - Topology seed; the same seed always yields the same creature.
 * @returns The creature.
 */
export function productionScaleCreature(seed: number): Creature {
  const creature = Creature.fromJSON(
    buildNetwork(
      seededRandom(seed),
      INPUT_COUNT,
      OUTPUT_COUNT,
      HIDDEN_LAYERS,
      MAX_FAN_OUT,
    ),
  );
  CreatureUtil.makeUUID(creature);
  return creature;
}
