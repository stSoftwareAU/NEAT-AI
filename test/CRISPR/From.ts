import { assert, assertAlmostEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CRISPR } from "@reconstruct/CRISPR.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("FromUUID", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/CRISPR/network.json")),
  );
  creature.validate();
  const crispr = new CRISPR(creature);
  const creatureB = crispr.cleaveDNA(
    JSON.parse(Deno.readTextFileSync("test/data/CRISPR/DNA-from-to.json")),
  );
  assert(creatureB);

  creatureB.validate();

  const exported = creatureB.exportJSON();
  Deno.writeTextFileSync(
    "test/data/CRISPR/.actual-from-to.json",
    JSON.stringify(exported, null, 1),
  );
  let foundFromToA = false;
  let foundFromToB = false;
  creatureB.synapses.forEach((synapse) => {
    const fromId = creatureB.neurons[synapse.from]?.id;
    const toId = creatureB.neurons[synapse.to]?.id;
    if (fromId === 299 && toId === -1) {
      foundFromToA = true;
      assertAlmostEquals(synapse.weight, 0.123);
    }
    if (fromId === 123 && toId === -1) {
      foundFromToB = true;
      assertAlmostEquals(synapse.weight, 0.456);
    }
  });

  assert(foundFromToA, "should have found synapse A");
  assert(foundFromToB, "should have found synapse B");

  const creatureC = Creature.fromJSON(exported);

  creatureC.validate();

  let foundTag = false;
  creatureC.synapses.forEach((synapse) => {
    const tag = getTag(synapse, "CRISPR");
    if (tag === "from-to") {
      foundTag = true;
    }
  });

  assert(foundTag, "Should have found the ID tag");

  const creatureD = Creature.fromJSON(creatureC.exportJSON());

  creatureD.validate();

  let foundTagD = false;
  creatureD.synapses.forEach((synapse) => {
    const tag = getTag(synapse, "CRISPR");
    if (tag === "from-to") {
      foundTagD = true;
    }
  });

  assert(foundTagD, "Should have found the ID tag");
});
