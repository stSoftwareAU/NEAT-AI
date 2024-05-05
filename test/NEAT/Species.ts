import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Creature, CreatureExport, CreatureUtil } from "../../mod.ts";
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
      squash: "ReLU",
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

function createCreatureJSON(
  //   modifications?: Partial<CreatureExport>,
): CreatureExport {
  return JSON.parse(JSON.stringify({ ...baseCreatureJSON }));
}

Deno.test("Add Creature to Species", async () => {
  const species = new Species("test-key");
  const creatureJSON = createCreatureJSON();
  const creature: Creature = Creature.fromJSON(creatureJSON);

  creature.validate();
  await CreatureUtil.makeUUID(creature);
  species.addCreature(creature);

  assertEquals(species.creatures.length, 1);
  assertEquals(species.creatures[0], creature);
});

Deno.test("Calculate Species Key Consistency", async () => {
  const creatureJSON = createCreatureJSON();
  const creature1: Creature = Creature.fromJSON(creatureJSON);

  const modifiedJSON = createCreatureJSON();
  modifiedJSON.synapses[0].weight = 0.1;
  const creature2: Creature = Creature.fromJSON(modifiedJSON);

  const key1 = await Species.calculateKey(creature1);
  const key2 = await Species.calculateKey(creature2);

  // Ensuring that similar creatures have the same species key
  assertEquals(key1, key2);
});

Deno.test("Species Key Uniqueness", async () => {
  const creature1JSON = createCreatureJSON();
  const creature1: Creature = Creature.fromJSON(creature1JSON);

  const creature2JSON = createCreatureJSON();
  creature2JSON.neurons[0].squash = "Cosine";
  console.info(creature2JSON);
  const creature2: Creature = Creature.fromJSON(creature2JSON);

  const key1 = await Species.calculateKey(creature1);
  const key2 = await Species.calculateKey(creature2);

  // Ensuring that different creatures have different species keys
  assertNotEquals(key1, key2);
});
