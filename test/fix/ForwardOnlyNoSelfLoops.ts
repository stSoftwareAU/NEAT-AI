import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("fix({ forwardOnly:true }): never creates self-loops; removes neurons with no forward targets", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    semanticVersion: "2.9.9",
    neurons: [
      // Hidden neuron deliberately has no connections.
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      // Keep output valid/connected.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  // Intentionally skip validation to simulate a "dirty" edited export.
  const creature = Creature.fromJSON(json, false);
  creature.forwardOnly = true;

  creature.fix({ forwardOnly: true });

  // Should be forward-only valid after fix.
  creature.validate({ forwardOnly: true });

  // Never create self loops in forward-only mode.
  assertEquals(creature.synapses.some((s) => s.from === s.to), false);

  // The disconnected hidden neuron should be removed entirely.
  assertEquals(creature.neurons.some((n) => n.uuid === "hidden-0"), false);
});
