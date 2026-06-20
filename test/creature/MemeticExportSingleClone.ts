/**
 * Issue #3088 — the creature export path must clone `creature.memetic` exactly
 * once and must never alias the live creature's memetic into the export.
 *
 * These are "what" tests: they assert on the exported wire JSON and on the
 * isolation of the live creature's memetic, not on how many clones happen
 * internally (that is measured by bench/export/ExportJsonMemetic.ts). They
 * pass before and after the optimisation and guard against a future change
 * that aliases memetic by reference without a downstream clone.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import { Creature } from "@creature";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";

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
  creature.score = -0.1;

  // Build a non-trivial runtime memetic keyed by the live integer ids so the
  // wire conversion has real weights/biases/ancestry to rewrite.
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

Deno.test("exportJSON: wire memetic is independent of live creature.memetic", () => {
  const creature = makeCreatureWithMemetic();
  const snapshot = JSON.stringify(creature.memetic);

  const exported = creature.exportJSON();
  assert(exported.memetic, "export should carry memetic");

  // Wire format: weights become an array of { fromUUID, toUUID, weight } rows,
  // biases are keyed by wire UUID strings (no numeric neuron keys).
  const wire = exported.memetic as unknown as {
    weights: Array<{ fromUUID: string; toUUID: string; weight: number }>;
    biases: Record<string, number>;
  };
  assert(Array.isArray(wire.weights), "wire weights should be an array");
  assertEquals(wire.weights[0].fromUUID, "hidden-3");
  assertEquals(wire.weights[0].toUUID, "hidden-4");
  assertEquals(wire.biases["hidden-3"], 3.1);

  // No aliasing: the export must not be the same object as the live memetic,
  // and mutating the export must not touch the live creature.
  assert(
    exported.memetic !== (creature.memetic as unknown),
    "export memetic must not be the same object as creature.memetic",
  );
  (exported.memetic as unknown as { biases: Record<string, number> }).biases =
    {};
  (exported.memetic as unknown as { weights: unknown[] }).weights = [];
  assertEquals(
    JSON.stringify(creature.memetic),
    snapshot,
    "mutating the export must not alter the live creature.memetic",
  );
});

Deno.test("exportJSONWithRuntimeIds: memetic is independent of live creature.memetic", () => {
  const creature = makeCreatureWithMemetic();
  const snapshot = JSON.stringify(creature.memetic);

  const exported = exportJSONWithRuntimeIds(creature);
  assert(exported.memetic, "runtime-id export should carry memetic");
  assert(
    exported.memetic !== (creature.memetic as unknown),
    "export memetic must not alias creature.memetic",
  );

  (exported.memetic as unknown as { biases: Record<string, number> }).biases =
    {};
  assertEquals(
    JSON.stringify(creature.memetic),
    snapshot,
    "mutating the runtime-id export must not alter the live creature.memetic",
  );
});

Deno.test("exportJSON → fromJSON round-trip preserves memetic values", () => {
  const creature = makeCreatureWithMemetic();
  const h3 = creature.neurons.find((n) => n.uuid === "hidden-3")!.id;
  const h4 = creature.neurons.find((n) => n.uuid === "hidden-4")!.id;

  const restored = Creature.fromJSON(creature.exportJSON());
  const m = restored.memetic as MemeticInterface;
  assert(m, "restored creature should have memetic");

  const rh3 = restored.neurons.find((n) => n.uuid === "hidden-3")!.id;
  const rh4 = restored.neurons.find((n) => n.uuid === "hidden-4")!.id;

  assertEquals(m.generation, 2);
  assertEquals(m.score, -0.2);
  assertEquals(m.biases[rh3], 3.1);
  assertEquals(m.biases[rh4], 2.1);
  assertEquals(m.weights[rh3][0].toId, rh4);
  assertEquals(m.weights[rh3][0].weight, -0.55);

  // Identity of original ids is irrelevant beyond resolving via UUID; this just
  // asserts the original creature still owns its own ids (not mutated by export).
  assertEquals(creature.neurons.find((n) => n.uuid === "hidden-3")!.id, h3);
  assertEquals(creature.neurons.find((n) => n.uuid === "hidden-4")!.id, h4);
});
