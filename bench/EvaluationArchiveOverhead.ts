/**
 * Issue #3929 — Benchmark: evaluation-archive overhead at production scale.
 *
 * The archive is only defensible if it does not register against the thing it
 * observes. On the GRQ lineage a generation scores ~20 creatures of ~5,300
 * neurons against a 21.2 GiB corpus in ~7.8 minutes (468,000 ms). This bench
 * measures what the archive adds to that:
 *
 * - `computeEvaluationDescriptor` for one production-scale creature, with and
 *   without a reference creature for the genetic-distance slot;
 * - `EvaluationArchive.record` — the whole per-evaluation hook;
 * - a whole generation: 20 records plus the single file append.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/EvaluationArchiveOverhead.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  EvaluationArchive,
  EXACT_FIDELITY,
} from "@archive/EvaluationArchive.ts";
import { computeEvaluationDescriptor } from "@archive/EvaluationDescriptor.ts";
import { resolveEvaluationArchiveConfig } from "@config/EvaluationArchiveConfig.ts";

/** Seeded generator so the topology is identical on every run. */
function seededRandom(seed: number) {
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
function buildNetwork(
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
const HIDDEN_LAYERS = [900, 1100, 1100, 900, 700, 588];
const INPUT_COUNT = 8;
const OUTPUT_COUNT = 4;
const MAX_FAN_OUT = 18;
/** Creatures a GRQ generation scores. */
const GENERATION_SIZE = 20;

const creature = Creature.fromJSON(
  buildNetwork(
    seededRandom(3929),
    INPUT_COUNT,
    OUTPUT_COUNT,
    HIDDEN_LAYERS,
    MAX_FAN_OUT,
  ),
);
CreatureUtil.makeUUID(creature);

const reference = Creature.fromJSON(
  buildNetwork(
    seededRandom(1919),
    INPUT_COUNT,
    OUTPUT_COUNT,
    HIDDEN_LAYERS,
    MAX_FAN_OUT,
  ),
);
CreatureUtil.makeUUID(reference);

/** A generation's worth of distinct creatures, so nothing is cached away. */
const generation = Array.from({ length: GENERATION_SIZE }, (_, i) => {
  const member = Creature.fromJSON(
    buildNetwork(
      seededRandom(3929 + i + 1),
      INPUT_COUNT,
      OUTPUT_COUNT,
      HIDDEN_LAYERS,
      MAX_FAN_OUT,
    ),
  );
  CreatureUtil.makeUUID(member);
  return member;
});

console.log(
  `\nIssue #3929 archive overhead — creature: ${creature.neurons.length} ` +
    `neurons, ${creature.synapses.length} synapses; generation of ` +
    `${GENERATION_SIZE}; GRQ generation budget ~468,000 ms\n`,
);

const benchDir = await Deno.makeTempDir({ prefix: "neat-archive-bench-" });
const archive = new EvaluationArchive(
  resolveEvaluationArchiveConfig({
    enabled: true,
    directory: benchDir,
    runId: "bench",
    // Big enough that the bench never trips compaction — retention cost is a
    // separate, amortised concern.
    maxRecords: 1_000_000,
  }),
);
archive.beginGeneration(1, reference);

Deno.bench("descriptor — production-scale creature, no reference", () => {
  computeEvaluationDescriptor(creature);
});

Deno.bench("descriptor — production-scale creature, with reference", () => {
  computeEvaluationDescriptor(creature, reference);
});

Deno.bench("archive.record — one exact evaluation", () => {
  archive.record(creature, {
    score: -0.5,
    fidelity: EXACT_FIDELITY,
    error: 0.5,
  });
});

Deno.bench("archive — a whole generation: 20 records + one flush", async () => {
  for (const member of generation) {
    archive.record(member, {
      score: -0.5,
      fidelity: EXACT_FIDELITY,
      error: 0.5,
    });
  }
  await archive.flush();
});
