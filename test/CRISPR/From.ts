import { assert, assertAlmostEquals } from "@std/assert";
import { getTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../../src/Creature.ts";
import { CRISPR } from "../../src/reconstruct/CRISPR.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("FromUUID", async () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/CRISPR/network.json")),
  );
  creature.validate();
  const crispr = new CRISPR(creature);
  const creatureB = await crispr.cleaveDNA(
    JSON.parse(Deno.readTextFileSync("test/data/CRISPR/DNA-from-to.json")),
  );
  assert(creatureB);

  creatureB.validate();

  const exported = creatureB.exportJSON();
  Deno.writeTextFileSync(
    "test/data/CRISPR/.actual-from-to.json",
    JSON.stringify(exported, null, 2),
  );
  let foundFromToA = false;
  let foundFromToB = false;
  exported.synapses.forEach((synapse) => {
    if (synapse.fromUUID == "input-299" && synapse.toUUID == "output-0") {
      foundFromToA = true;
      assertAlmostEquals(synapse.weight, 0.123);
    }
    if (synapse.fromUUID == "input-123" && synapse.toUUID == "output-0") {
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
    if (tag == "from-to") {
      foundTag = true;
    }
  });

  assert(foundTag, "Should have found the ID tag");

  const creatureD = Creature.fromJSON(creatureC.internalJSON());

  creatureD.validate();

  let foundTagD = false;
  creatureD.synapses.forEach((synapse) => {
    const tag = getTag(synapse, "CRISPR");
    if (tag == "from-to") {
      foundTagD = true;
    }
  });

  assert(foundTagD, "Should have found the ID tag");
});
