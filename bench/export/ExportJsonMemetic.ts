/**
 * Issue #3088 — benchmark the creature export path on a creature carrying a
 * non-trivial memetic blob (weights / biases / ancestry).
 *
 * The existing export benches (ExportJson.ts) and worker benches
 * (bench/WorkerJsonSerialisation.ts) do not populate `creature.memetic`, so
 * they never exercised the memetic deep-clone that dominated this path.
 *
 * Before #3088 the export deep-cloned `creature.memetic` twice (once in
 * CreatureExportBuilder.build(), then again inside
 * convertMemeticExportToWireJson) and threw the first clone away. After #3088
 * the wire converter is the single owner that clones exactly once.
 *
 * Run: deno bench --allow-all bench/export/ExportJsonMemetic.ts
 */
import { Creature } from "@creature";
import type { CreatureExport } from "../../mod.ts";
import {
  exportJSONWithRuntimeIds,
} from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type {
  MemeticAncestorSnapshot,
  MemeticBiasInterface,
  MemeticInterface,
  MemeticWeightsInterface,
} from "@blackbox/MemeticInterface.ts";

const INPUT = 8;
const HIDDEN = 200;
const OUTPUT = 4;
const ANCESTRY_DEPTH = 3;

/** Build a dense-ish feed-forward creature with HIDDEN hidden neurons. */
function buildCreature(): Creature {
  const neurons: CreatureExport["neurons"] = [];
  for (let i = 0; i < HIDDEN; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      squash: "LOGISTIC",
      bias: (i % 7) * 0.1 - 0.3,
    });
  }
  for (let o = 0; o < OUTPUT; o++) {
    neurons.push({
      type: "output",
      uuid: `output-${o}`,
      squash: "IDENTITY",
      bias: o * 0.05,
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  // input → hidden
  for (let h = 0; h < HIDDEN; h++) {
    const i = h % INPUT;
    synapses.push({
      fromUUID: `input-${i}`,
      toUUID: `hidden-${h}`,
      weight: 0.01 * h - 0.5,
    });
  }
  // hidden → hidden (forward only: lower index → higher index)
  for (let h = 1; h < HIDDEN; h++) {
    synapses.push({
      fromUUID: `hidden-${h - 1}`,
      toUUID: `hidden-${h}`,
      weight: 0.02 * h - 0.4,
    });
  }
  // last hidden → outputs
  for (let o = 0; o < OUTPUT; o++) {
    synapses.push({
      fromUUID: `hidden-${HIDDEN - 1}`,
      toUUID: `output-${o}`,
      weight: 0.3 + o * 0.05,
    });
  }

  const json: CreatureExport = {
    neurons,
    synapses,
    input: INPUT,
    output: OUTPUT,
  };
  const creature = Creature.fromJSON(json);
  creature.score = -0.1;
  creature.memetic = buildMemetic(creature);
  return creature;
}

/** Populate a memetic snapshot (weights/biases) keyed by runtime integer ids. */
function buildSnapshot(creature: Creature): {
  weights: MemeticWeightsInterface;
  biases: MemeticBiasInterface;
} {
  const idOf = (uuid: string) =>
    creature.neurons.find((n) => n.uuid === uuid)!.id;
  const biases: MemeticBiasInterface = {};
  const weights: MemeticWeightsInterface = {};
  for (let h = 0; h < HIDDEN; h++) {
    const id = idOf(`hidden-${h}`);
    biases[id] = 0.1 * h - 0.5;
    if (h > 0) {
      const fromId = idOf(`hidden-${h - 1}`);
      weights[fromId] = [{ toId: id, weight: 0.02 * h - 0.4 }];
    }
  }
  return { weights, biases };
}

function buildMemetic(creature: Creature): MemeticInterface {
  const base = buildSnapshot(creature);
  const ancestry: MemeticAncestorSnapshot[] = [];
  for (let g = 0; g < ANCESTRY_DEPTH; g++) {
    const snap = buildSnapshot(creature);
    ancestry.push({
      generation: g,
      score: -0.2 - g * 0.01,
      weights: snap.weights,
      biases: snap.biases,
    });
  }
  return {
    generation: ANCESTRY_DEPTH,
    score: -0.2,
    weights: base.weights,
    biases: base.biases,
    ancestry,
  };
}

const creature = buildCreature();

Deno.bench("exportJSON (wire, with memetic)", () => {
  creature.exportJSON();
});

Deno.bench("exportJSONWithRuntimeIds (with memetic)", () => {
  exportJSONWithRuntimeIds(creature);
});
