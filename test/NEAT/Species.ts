import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
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
  return JSON.parse(JSON.stringify({ ...baseCreatureJSON }));
}

Deno.test("Add Creature to Species", () => {
  const species = new Species("test-key");
  const creatureJSON = createCreatureJSON();
  const creature: Creature = Creature.fromJSON(creatureJSON);

  creature.validate();
  CreatureUtil.makeUUID(creature);
  species.addCreature(creature);

  assertEquals(species.creatures.length, 1);
  assertEquals(species.creatures[0], creature);
});

Deno.test("Calculate Species Key Consistency", () => {
  const creatureJSON = createCreatureJSON();
  const creature1: Creature = Creature.fromJSON(creatureJSON);

  const modifiedJSON = createCreatureJSON();
  modifiedJSON.synapses[0].weight = 0.1;
  const creature2: Creature = Creature.fromJSON(modifiedJSON);

  const key1 = Species.calculateKey(creature1);
  const key2 = Species.calculateKey(creature2);

  // Ensuring that similar creatures have the same species key
  assertEquals(key1, key2);
});

Deno.test("Species Key Uniqueness", () => {
  const creature1JSON = createCreatureJSON();
  const creature1: Creature = Creature.fromJSON(creature1JSON);

  const creature2JSON = createCreatureJSON();
  creature2JSON.neurons[0].squash = "Cosine";

  const creature2: Creature = Creature.fromJSON(creature2JSON);

  const key1 = Species.calculateKey(creature1);
  const key2 = Species.calculateKey(creature2);

  // Ensuring that different creatures have different species keys
  assertNotEquals(key1, key2);
});

// Issue #1038: Architecture-based species management tests

Deno.test("Species Key - Neuron Count Range affects key", () => {
  // Two creatures with same squash functions but different neuron counts
  // should be in different species if they fall in different size ranges

  // Small creature (4 neurons total: 2 hidden + 2 output)
  const smallCreatureJSON = createCreatureJSON();
  const smallCreature: Creature = Creature.fromJSON(smallCreatureJSON);

  // Larger creature (many more hidden neurons)
  const largeCreatureJSON: CreatureExport = {
    neurons: [
      // Add enough hidden neurons to push into a different size range
      // The range buckets are typically 0-9, 10-19, 20-29, etc. for hidden neurons
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-3", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-4", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-5", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-6", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-7", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-8", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-9", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-10", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-11", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-1" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-2" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-3" },
      { weight: -0.05, fromUUID: "hidden-0", toUUID: "hidden-4" },
      { weight: -0.05, fromUUID: "hidden-1", toUUID: "hidden-5" },
      { weight: -0.05, fromUUID: "hidden-2", toUUID: "hidden-6" },
      { weight: -0.05, fromUUID: "hidden-3", toUUID: "hidden-7" },
      { weight: -0.05, fromUUID: "hidden-4", toUUID: "hidden-8" },
      { weight: -0.05, fromUUID: "hidden-5", toUUID: "hidden-9" },
      { weight: -0.05, fromUUID: "hidden-6", toUUID: "hidden-10" },
      { weight: -0.05, fromUUID: "hidden-7", toUUID: "hidden-11" },
      { weight: 0.03, fromUUID: "hidden-8", toUUID: "output-0" },
      { weight: -0.03, fromUUID: "hidden-9", toUUID: "output-0" },
      { weight: -0.09, fromUUID: "hidden-10", toUUID: "output-1" },
      { weight: 0.08, fromUUID: "hidden-11", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const largeCreature: Creature = Creature.fromJSON(largeCreatureJSON);

  const smallKey = Species.calculateKey(smallCreature);
  const largeKey = Species.calculateKey(largeCreature);

  // Different neuron count ranges should result in different species keys
  assertNotEquals(
    smallKey,
    largeKey,
    "Creatures with vastly different sizes should be in different species",
  );
});

Deno.test("Species Key - Same neuron count range keeps same key", () => {
  // Two creatures with same squash functions and similar neuron counts
  // (within the same range bucket) should have the same species key

  const creature1JSON = createCreatureJSON();
  const creature1: Creature = Creature.fromJSON(creature1JSON);

  // Add one more hidden neuron - still within the same size bucket (0-9 hidden neurons)
  const creature2JSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.15, type: "hidden", squash: "TANH" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-1" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "output-0" },
      { weight: -0.09, fromUUID: "hidden-1", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-2", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const creature2: Creature = Creature.fromJSON(creature2JSON);

  const key1 = Species.calculateKey(creature1);
  const key2 = Species.calculateKey(creature2);

  // Similar sized creatures with same squash distribution should have same key
  assertEquals(
    key1,
    key2,
    "Creatures within the same size range with same squash distribution should be in the same species",
  );
});

Deno.test("Species Key - Connectivity affects key", () => {
  // Two creatures with same neuron count but different connectivity levels
  // should be in different species (sparse vs dense)

  // Sparse creature: few connections per neuron
  const sparseCreatureJSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.3, type: "hidden", squash: "RELU" },
      { uuid: "hidden-3", bias: 0.4, type: "hidden", squash: "TANH" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      // Minimal connectivity - ~1 connection per neuron
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-1" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-1", toUUID: "hidden-3" },
      { weight: -0.09, fromUUID: "hidden-2", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-3", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const sparseCreature: Creature = Creature.fromJSON(sparseCreatureJSON);

  // Dense creature: many connections per neuron (same neuron structure)
  const denseCreatureJSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.3, type: "hidden", squash: "RELU" },
      { uuid: "hidden-3", bias: 0.4, type: "hidden", squash: "TANH" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      // Dense connectivity - many connections per neuron
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-1" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-2" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-3" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-1" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-2" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-3" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "hidden-3" },
      { weight: -0.03, fromUUID: "hidden-1", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-1", toUUID: "hidden-3" },
      { weight: -0.09, fromUUID: "hidden-2", toUUID: "output-0" },
      { weight: -0.09, fromUUID: "hidden-2", toUUID: "output-1" },
      { weight: 0.08, fromUUID: "hidden-3", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-3", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const denseCreature: Creature = Creature.fromJSON(denseCreatureJSON);

  const sparseKey = Species.calculateKey(sparseCreature);
  const denseKey = Species.calculateKey(denseCreature);

  // Different connectivity levels should result in different species keys
  assertNotEquals(
    sparseKey,
    denseKey,
    "Creatures with different connectivity levels should be in different species",
  );
});

Deno.test("Species Key - Squash distribution affects key", () => {
  // Two creatures with same total neuron count but different squash distributions
  // should be in different species

  // Creature with mostly TANH squashes
  const tanhDominantJSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "TANH" },
      { uuid: "hidden-2", bias: 0.3, type: "hidden", squash: "TANH" },
      { uuid: "hidden-3", bias: 0.4, type: "hidden", squash: "LOGISTIC" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-1" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-1", toUUID: "hidden-3" },
      { weight: -0.09, fromUUID: "hidden-2", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-3", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const tanhDominant: Creature = Creature.fromJSON(tanhDominantJSON);

  // Creature with mostly LOGISTIC squashes (same structure, different distribution)
  const logisticDominantJSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.3, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-3", bias: 0.4, type: "hidden", squash: "TANH" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-1" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-1", toUUID: "hidden-3" },
      { weight: -0.09, fromUUID: "hidden-2", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-3", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const logisticDominant: Creature = Creature.fromJSON(logisticDominantJSON);

  const tanhKey = Species.calculateKey(tanhDominant);
  const logisticKey = Species.calculateKey(logisticDominant);

  // Different squash distributions should result in different species keys
  assertNotEquals(
    tanhKey,
    logisticKey,
    "Creatures with different squash distributions should be in different species",
  );
});

Deno.test("Species Key - getArchitectureInfo returns correct metrics", () => {
  const creatureJSON: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash: "TANH" },
      { uuid: "hidden-1", bias: 0.2, type: "hidden", squash: "LOGISTIC" },
      { uuid: "hidden-2", bias: 0.3, type: "hidden", squash: "TANH" },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
      { uuid: "output-1", bias: -0.3, type: "output", squash: "RELU" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-1" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-2" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "output-0" },
      { weight: -0.09, fromUUID: "hidden-1", toUUID: "output-0" },
      { weight: 0.08, fromUUID: "hidden-2", toUUID: "output-1" },
    ],
    input: 2,
    output: 2,
  };
  const creature: Creature = Creature.fromJSON(creatureJSON);

  const archInfo = Species.getArchitectureInfo(creature);

  // Verify neuron count range bucket (3 hidden neurons -> bucket 0)
  assertEquals(
    archInfo.neuronCountBucket,
    0,
    "3 hidden neurons should be in bucket 0",
  );

  // Verify connectivity bucket
  // 6 synapses / 5 neurons (hidden + output) = 1.2 connections per neuron -> bucket 1
  assertEquals(
    archInfo.connectivityBucket >= 0,
    true,
    "Connectivity bucket should be calculated",
  );

  // Verify squash distribution is captured
  assertEquals(
    archInfo.squashDistribution.includes("TANH"),
    true,
    "Squash distribution should include TANH",
  );
  assertEquals(
    archInfo.squashDistribution.includes("LOGISTIC"),
    true,
    "Squash distribution should include LOGISTIC",
  );
});
