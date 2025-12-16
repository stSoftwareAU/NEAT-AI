import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";

Deno.test("fix({ forwardOnly: true }) removes back + self connections", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },

      // Back + self connections that should be removed when forwardOnly is enabled.
      { fromUUID: "output-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-0", weight: 0.25 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Default validation allows memory + self connections.
  creature.validate();

  creature.fix({ forwardOnly: true });
  creature.validate({ forwardOnly: true });

  // Ensure structure is now strictly forward-only.
  creature.synapses.forEach((s) => {
    assert(
      s.from < s.to,
      `Expected strict forward-only synapse, got ${s.from}->${s.to}`,
    );
  });
});
