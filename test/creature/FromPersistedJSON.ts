import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";

Deno.test(
  "fromPersistedJSON: forward-only corrupt JSON becomes valid (GRQ disk path)",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "h0", weight: 0.2 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "output-0", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const creature = Creature.fromPersistedJSON(json);

    assertEquals(creature.forwardOnly, true);
    assertEquals(creature.synapses.length, 3);
    creature.validate({ forwardOnly: true });
  },
);

Deno.test("fromPersistedJSON: fresh-shaped genome matches fromJSON for valid data", () => {
  const creatureA = new Creature(2, 1);
  const json = creatureA.exportJSON();
  const creatureB = Creature.fromPersistedJSON(json);

  assertEquals(creatureB.input, 2);
  assertEquals(creatureB.output, 1);
  assertEquals(creatureB.forwardOnly, creatureA.forwardOnly);
  creatureB.validate({ forwardOnly: creatureB.forwardOnly });
});
