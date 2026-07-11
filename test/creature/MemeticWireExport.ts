/**
 * Issue #3315 — `convertMemeticSnapshotToWireJson` is module-private; the public
 * wire-conversion entry point is `convertMemeticExportToWireJson`, which rewrites
 * the root memetic snapshot AND every ancestry snapshot to wire JSON.
 *
 * These are "what" tests: they exercise the public function with a runtime
 * (integer-keyed) memetic and assert on the resulting wire shape — biases keyed
 * by wire UUID strings and weights as `{ fromUUID, toUUID, weight }` rows — for
 * both the root snapshot and its ancestry. They pass regardless of whether the
 * per-snapshot helper is exported, so they guard the dead-export removal.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import { Creature } from "@creature";
import { convertMemeticExportToWireJson } from "@creature/MemeticWireExport.ts";

function makeCreatureWithMemetic(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", id: 5003, uuid: "hidden-3", squash: "Cosine", bias: 3 },
      {
        type: "hidden",
        id: 5004,
        uuid: "hidden-4",
        squash: "CLIPPED",
        bias: 2,
      },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 1 },
      { type: "output", squash: "IDENTITY", uuid: "output-1", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  const idOf = (uuid: string): number =>
    creature.neurons.find((n) => n.uuid === uuid)!.id;
  const h3 = idOf("hidden-3");
  const h4 = idOf("hidden-4");

  creature.memetic = {
    generation: 2,
    score: -0.2,
    biases: { [h3]: 3.1, [h4]: 2.1 },
    weights: { [h3]: [{ toId: h4, weight: -0.55 }] },
    ancestry: [
      {
        generation: 1,
        score: -0.3,
        biases: { [h3]: 3.0 },
        weights: { [h3]: [{ toId: h4, weight: -0.5 }] },
      },
    ],
  };
  return creature;
}

Deno.test("convertMemeticExportToWireJson: root snapshot uses wire UUIDs", () => {
  const creature = makeCreatureWithMemetic();

  const wire = convertMemeticExportToWireJson(
    creature,
    creature.memetic as MemeticInterface,
  ) as unknown as {
    biases: Record<string, number>;
    weights: Array<{ fromUUID: string; toUUID: string; weight: number }>;
  };

  // Biases keyed by wire UUID strings, no numeric neuron keys.
  assertEquals(wire.biases["hidden-3"], 3.1);
  assertEquals(wire.biases["hidden-4"], 2.1);

  // Weights become an array of synapse-shaped rows.
  assert(Array.isArray(wire.weights), "wire weights should be an array");
  assertEquals(wire.weights.length, 1);
  assertEquals(wire.weights[0].fromUUID, "hidden-3");
  assertEquals(wire.weights[0].toUUID, "hidden-4");
  assertEquals(wire.weights[0].weight, -0.55);
});

Deno.test("convertMemeticExportToWireJson: ancestry snapshots are converted too", () => {
  const creature = makeCreatureWithMemetic();

  const wire = convertMemeticExportToWireJson(
    creature,
    creature.memetic as MemeticInterface,
  ) as unknown as {
    ancestry: Array<{
      biases: Record<string, number>;
      weights: Array<{ fromUUID: string; toUUID: string; weight: number }>;
    }>;
  };

  assert(Array.isArray(wire.ancestry), "ancestry should survive conversion");
  const snap = wire.ancestry[0];
  assertEquals(snap.biases["hidden-3"], 3.0);
  assert(Array.isArray(snap.weights), "ancestry weights should be an array");
  assertEquals(snap.weights[0].fromUUID, "hidden-3");
  assertEquals(snap.weights[0].toUUID, "hidden-4");
  assertEquals(snap.weights[0].weight, -0.5);
});

Deno.test("convertMemeticExportToWireJson: deep-clones — live creature.memetic untouched", () => {
  const creature = makeCreatureWithMemetic();
  const snapshot = JSON.stringify(creature.memetic);

  const wire = convertMemeticExportToWireJson(
    creature,
    creature.memetic as MemeticInterface,
  );

  assert(
    (wire as unknown) !== (creature.memetic as unknown),
    "wire result must be a distinct object from the live memetic",
  );
  assertEquals(
    JSON.stringify(creature.memetic),
    snapshot,
    "conversion must not mutate the live creature.memetic",
  );
});
