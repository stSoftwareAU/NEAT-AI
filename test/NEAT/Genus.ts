import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Genus } from "../../src/NEAT/Genus.ts";
import { Species } from "../../src/NEAT/Species.ts";

const baseCreatureJSON: CreatureExport = {
  neurons: [
    {
      uuid: "hidden-0",
      bias: 0.1,
      type: "hidden",
      squash: "TANH",
    },
    {
      uuid: "hidden-1",
      bias: 0.2,
      type: "hidden",
      squash: "LOGISTIC",
    },
    {
      uuid: "output-0",
      bias: 0.4,
      type: "output",
      squash: "IF",
    },
    {
      uuid: "output-1",
      bias: -0.3,
      type: "output",
      squash: "RELU",
    },
  ],
  synapses: [
    {
      weight: -0.05643947781091945,
      fromUUID: "input-0",
      toUUID: "hidden-0",
    },
    {
      weight: -0.05312834974349934,
      fromUUID: "input-0",
      toUUID: "hidden-1",
    },
    {
      weight: 0.0306819508373688,
      fromUUID: "input-1",
      toUUID: "output-0",
      type: "negative",
    },

    {
      weight: -0.03496077324134794,
      fromUUID: "hidden-0",
      toUUID: "output-0",
      type: "condition",
    },
    {
      weight: -0.09636098569100936,
      fromUUID: "hidden-1",
      toUUID: "output-0",
      type: "positive",
    },
    {
      weight: 0.08808051749556417,
      fromUUID: "hidden-1",
      toUUID: "output-1",
    },
  ],
  "input": 2,
  "output": 2,
};

function createCreatureJSON(): CreatureExport {
  return JSON.parse(JSON.stringify(baseCreatureJSON));
}

Deno.test("Add Creature to Genus and Create New Species", async () => {
  const genus = new Genus();

  const creatureJSON = createCreatureJSON();
  const creature: Creature = Creature.fromJSON(creatureJSON);
  await CreatureUtil.makeUUID(creature);
  const species = await genus.addCreature(creature);

  assertEquals(genus.speciesMap.size, 1);
  assertEquals(species.creatures.length, 1);
  assertEquals(species.creatures[0], creature);
});

Deno.test("Find Species by Creature UUID", async () => {
  const genus = new Genus();
  const creatureJSON = createCreatureJSON();
  const creature: Creature = Creature.fromJSON(creatureJSON);
  const uuid = await CreatureUtil.makeUUID(creature);
  await genus.addCreature(creature);
  const foundSpecies = genus.findSpeciesByCreatureUUID(uuid);

  assertEquals(
    foundSpecies,
    genus.speciesMap.get(await Species.calculateKey(creature)),
  );
});

Deno.test("Error Handling for Undefined Creature in addCreature", async () => {
  const genus = new Genus();
  const creatureJSON = createCreatureJSON();
  const creature: Creature = Creature.fromJSON(creatureJSON);

  await assertRejects(
    async () => {
      await genus.addCreature(creature);
    },
    Error,
    "No creature UUID",
  );
});

// Deno.test("Error Handling for Nonexistent Creature UUID", () => {
//   const genus = new Genus();

//   assertThrows(
//     () => {
//       genus.findSpeciesByCreatureUUID("nonexistent-uuid");
//     },
//     Error,
//     "Could not find species for creature nonexistent-uuid",
//   );
// });

Deno.test("Find Closest Matching Species", async () => {
  const genus = new Genus();

  const speciesVariations = [2, 4, 6]; // Different by 2, 4, and 6 neurons
  const speciesCounts = [3, 1, 5]; // Population sizes for each species

  for (let i = 0; i < speciesVariations.length; i++) {
    for (let j = 0; j < speciesCounts[i]; j++) {
      const json = createCreatureJSON();

      const creature = Creature.fromJSON(json);
      creature.mutate({ name: "ADD_NODE" });
      await CreatureUtil.makeUUID(creature);
      await genus.addCreature(creature);
    }
  }

  // Create a test creature whose species should have 2 fewer neurons than base
  const testCreatureJSON = createCreatureJSON();

  const testCreature: Creature = Creature.fromJSON(testCreatureJSON);
  testCreature.mutate({ name: "SUB_NODE" });
  await CreatureUtil.makeUUID(testCreature);
  await genus.addCreature(testCreature);

  // Find the closest matching species, which should have 4 fewer neurons (baseNeuronCount - 4)
  const closestSpecies = genus.findClosestMatchingSpecies(testCreature);

  assertNotEquals(
    closestSpecies?.speciesKey,
    await Species.calculateKey(testCreature),
  );
});
