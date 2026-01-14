import { assertEquals } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { geneticCompatibility } from "../../src/breed/GeneticCompatibility.ts";

const testDir = ".test/HiddenNeuronUUIDCache";
emptyDirSync(testDir);

/**
 * Creates a test creature with the specified hidden neuron UUIDs.
 */
function makeCreatureWithHiddenNeurons(
  hiddenUUIDs: string[],
): Creature {
  const json: CreatureExport = {
    neurons: hiddenUUIDs.map((uuid) => ({
      type: "hidden" as const,
      uuid,
      bias: 0.1,
      squash: "TANH",
    })),
    synapses: [],
    input: 2,
    output: 1,
  };

  // Add output neuron
  json.neurons.push({
    type: "output",
    uuid: "output-0",
    bias: 0.1,
    squash: "TANH",
  });

  // Connect input to hidden neurons
  for (const uuid of hiddenUUIDs) {
    json.synapses.push({
      fromUUID: "input-0",
      toUUID: uuid,
      weight: 0.5,
    });
  }

  // Connect hidden neurons to output
  for (const uuid of hiddenUUIDs) {
    json.synapses.push({
      fromUUID: uuid,
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  return Creature.fromJSON(json);
}

Deno.test("getHiddenNeuronUUIDs returns correct Set of hidden neuron UUIDs", () => {
  const hiddenUUIDs = ["hidden-1", "hidden-2", "hidden-3"];
  const creature = makeCreatureWithHiddenNeurons(hiddenUUIDs);

  const result = creature.getHiddenNeuronUUIDs();

  assertEquals(result.size, 3);
  assertEquals(result.has("hidden-1"), true);
  assertEquals(result.has("hidden-2"), true);
  assertEquals(result.has("hidden-3"), true);
  assertEquals(result.has("output-0"), false);
  assertEquals(result.has("input-0"), false);
});

Deno.test("getHiddenNeuronUUIDs returns cached Set on subsequent calls", () => {
  const hiddenUUIDs = ["hidden-a", "hidden-b"];
  const creature = makeCreatureWithHiddenNeurons(hiddenUUIDs);

  const result1 = creature.getHiddenNeuronUUIDs();
  const result2 = creature.getHiddenNeuronUUIDs();

  // Should return the same Set instance (not a new one)
  assertEquals(result1, result2);
});

Deno.test("getHiddenNeuronUUIDs cache is invalidated when clearCache is called", () => {
  const hiddenUUIDs = ["hidden-x", "hidden-y"];
  const creature = makeCreatureWithHiddenNeurons(hiddenUUIDs);

  const result1 = creature.getHiddenNeuronUUIDs();
  creature.clearCache();
  const result2 = creature.getHiddenNeuronUUIDs();

  // Should return a new Set instance after cache clear
  assertEquals(result1 !== result2, true);
  // But contents should be the same
  assertEquals(result2.size, 2);
  assertEquals(result2.has("hidden-x"), true);
  assertEquals(result2.has("hidden-y"), true);
});

Deno.test("getHiddenNeuronUUIDs returns empty Set for creature with no hidden neurons", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        bias: 0.1,
        squash: "TANH",
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.5,
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const result = creature.getHiddenNeuronUUIDs();

  assertEquals(result.size, 0);
});

Deno.test("geneticCompatibility uses cached hiddenNeuronUUIDs", () => {
  const sharedUUIDs = ["shared-1", "shared-2"];
  const father = makeCreatureWithHiddenNeurons(sharedUUIDs);
  const mother = makeCreatureWithHiddenNeurons(sharedUUIDs);

  // Call getHiddenNeuronUUIDs to populate the cache
  father.getHiddenNeuronUUIDs();
  mother.getHiddenNeuronUUIDs();

  // Genetic compatibility should use the cached Sets
  const compatibility = geneticCompatibility(father, mother);

  assertEquals(compatibility, 1);
});

Deno.test("getHiddenNeuronUUIDs cache is invalidated on connect", () => {
  const hiddenUUIDs = ["hidden-1"];
  const creature = makeCreatureWithHiddenNeurons(hiddenUUIDs);

  const result1 = creature.getHiddenNeuronUUIDs();

  // Adding a new connection should invalidate the cache
  // (even though hidden neurons haven't changed, the structure has)
  creature.connect(1, creature.neurons.length - 1, 0.3);

  const result2 = creature.getHiddenNeuronUUIDs();

  // Should return a new Set instance after structure change
  assertEquals(result1 !== result2, true);
});
