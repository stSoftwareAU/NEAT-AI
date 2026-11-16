import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { discover } from "../../src/blackbox/Discover.ts";

Deno.test("memetic discovery: a changed activation cannot inherit a parent's parameter deltas", () => {
  const parent = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [{
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 1 }],
  });
  parent.score = -0.1;
  const child = Creature.fromJSON(parent.exportJSON());
  child.neurons[1].setSquash("LOGISTIC");
  child.synapses[0].weight = 2;

  discover(parent, child);

  assertEquals(child.memetic, undefined);
  assertEquals(child.neurons[1].squash, "LOGISTIC");
  assertEquals(child.synapses[0].weight, 2);
});
