import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("fix(): keeps the last zero-weight inbound synapse to an output (structure safety)", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      // Only inbound connection to output, but weight is zero.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0 },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  creature.fix();
  creature.validate();

  assertEquals(creature.synapses.length, 1);
  assertEquals(creature.synapses[0].weight, 0);
  assertEquals(creature.neurons.some((n) => n.uuid === "output-0"), true);
});
