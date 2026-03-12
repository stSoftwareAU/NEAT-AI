import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  cleanupOrphanedNeurons,
  cleanupOrphanedNeuronsInCreature,
} from "../../src/compact/OrphanedNeuronCleanup.ts";
import type { CleanupOrphanedResult } from "../../src/compact/OrphanedNeuronCleanup.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("OrphanedNeuronCleanup - direct import removes orphaned neuron", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "orphan-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "alive-h", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "orphan-h", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "alive-h", weight: 0.4 },
      { fromUUID: "alive-h", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const result: CleanupOrphanedResult = cleanupOrphanedNeurons(exported);
  assert(result.removed > 0);
  const uuids = exported.neurons.map((n) => n.uuid);
  assert(!uuids.includes("orphan-h"));
});

Deno.test("OrphanedNeuronCleanup - converts hidden with no inward to constant", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "no-inward", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "no-inward", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const result = cleanupOrphanedNeurons(exported);
  assert(result.converted > 0);
  const converted = exported.neurons.find((n) => n.uuid === "no-inward")!;
  assertEquals(converted.type, "constant");
});

Deno.test("OrphanedNeuronCleanup - cleanupOrphanedNeuronsInCreature works on live creature", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "orphan-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "alive-h", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "orphan-h", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "alive-h", weight: 0.4 },
      { fromUUID: "alive-h", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const result = cleanupOrphanedNeuronsInCreature(creature);
  assert(result.removed > 0);
});
