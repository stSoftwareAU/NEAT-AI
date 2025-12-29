import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("fix(): when merging duplicate synapses, de-duplicates tags by {name,value}", () => {
  const tag1 = { name: "source", value: "unit-test" };
  const tag2 = { name: "source", value: "unit-test" };

  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [{
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    }],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.5,
        tags: [tag1],
      },
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.5,
        tags: [tag2],
      },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  creature.fix();

  assertEquals(creature.synapses.length, 1);
  const tags = creature.synapses[0].tags ?? [];
  assertEquals(tags.length, 1);
  assertEquals(tags[0].name, "source");
  assertEquals(tags[0].value, "unit-test");
});
