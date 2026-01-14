import { assert, assertAlmostEquals } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { geneticCompatibility } from "../../src/breed/GeneticCompatibility.ts";

const testDir = ".test/GeneticCompatibility";
emptyDirSync(testDir);

function three(idx: number) {
  const padded = "000" + idx;
  return padded.slice(padded.length - 3);
}

function makeTestCreature(uuidPrefix: string): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `${uuidPrefix}-000`, bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-001`, bias: -0.9, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-002`, bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-003`, bias: -0.8, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-004`, bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-005`, bias: 0, squash: "TANH" },
      { type: "hidden", uuid: `${uuidPrefix}-006`, bias: 0.1, squash: "TANH" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `${uuidPrefix}-002`, weight: -0.3 },
      { fromUUID: "input-1", toUUID: `${uuidPrefix}-000`, weight: -0.3 },
      {
        fromUUID: `${uuidPrefix}-000`,
        toUUID: `${uuidPrefix}-001`,
        weight: 0.3,
      },
      {
        fromUUID: `${uuidPrefix}-001`,
        toUUID: `${uuidPrefix}-002`,
        weight: 0.3,
      },
      {
        fromUUID: `${uuidPrefix}-002`,
        toUUID: `${uuidPrefix}-003`,
        weight: 0.6,
      },
      {
        fromUUID: `${uuidPrefix}-003`,
        toUUID: `${uuidPrefix}-004`,
        weight: 0.31,
      },
      {
        fromUUID: `${uuidPrefix}-004`,
        toUUID: `${uuidPrefix}-005`,
        weight: 0.33,
      },
      {
        fromUUID: `${uuidPrefix}-005`,
        toUUID: `${uuidPrefix}-006`,
        weight: 0.33,
      },
      { fromUUID: `${uuidPrefix}-004`, toUUID: "output-0", weight: 0.31 },
      { fromUUID: `${uuidPrefix}-006`, toUUID: "output-0", weight: 0.32 },
      { fromUUID: `${uuidPrefix}-000`, toUUID: "output-0", weight: -0.35 },
      { fromUUID: `${uuidPrefix}-000`, toUUID: "output-1", weight: 0.36 },
    ],
    input: 3,
    output: 2,
  };
  for (let i = 0; i < 100; i++) {
    json.neurons.push({
      type: "hidden",
      uuid: `${uuidPrefix}-${three(i + 7)}`,
      bias: 0.1,
      squash: "TANH",
    });
    json.synapses.push({
      fromUUID: `${uuidPrefix}-${three(i + 6)}`,
      toUUID: `${uuidPrefix}-${three(i + 7)}`,
      weight: 0.3,
    });
  }
  json.synapses.push({
    fromUUID: `${uuidPrefix}-106`,
    toUUID: "output-1",
    weight: 0.36,
  });

  json.neurons.push({
    type: "output",
    uuid: "output-0",
    bias: 0.1,
    squash: "TANH",
  });
  json.neurons.push({
    type: "output",
    uuid: "output-1",
    bias: 0.1,
    squash: "TANH",
  });

  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  Deno.writeTextFileSync(
    `${testDir}/${uuidPrefix}.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  return creature;
}

Deno.test("Genetic Compatibly Zero percent", () => {
  const parent = makeTestCreature("parent");
  const target = makeTestCreature("target");

  const compatibly = geneticCompatibility(parent, target);
  assert(
    compatibly === 0,
    `Genetic compatibility should be 0 was: ${compatibly}`,
  );
});

Deno.test("Genetic Compatibly 100 percent", () => {
  const parent = makeTestCreature("parent");
  const exportJSON = parent.exportJSON();

  exportJSON.neurons = [
    {
      type: "hidden",
      uuid: "other-000",
      bias: 0.1,
      squash: "TANH",
    },
    ...exportJSON.neurons,
  ];

  exportJSON.synapses.push({
    fromUUID: "input-1",
    toUUID: "other-000",
    weight: 0.3,
  });

  exportJSON.synapses.push({
    fromUUID: "other-000",
    toUUID: "output-1",
    weight: 0.3,
  });

  const target = Creature.fromJSON(exportJSON);
  target.validate();

  const compatibly = geneticCompatibility(parent, target);
  assertAlmostEquals(
    compatibly,
    1,
    0.0001,
    `Genetic compatibility should be 1 was: ${compatibly}`,
  );
});

/**
 * Issue #1033: Test partial overlap scenario for Set intersection optimisation.
 * This test ensures the optimised direct iteration approach produces the same
 * result as the original spread + filter approach.
 */
Deno.test("Genetic Compatibility 50 percent overlap", () => {
  // Create creature A with shared + unique neurons
  const sharedNeurons = [];
  const synapsesA = [];

  // 5 shared hidden neurons
  for (let i = 0; i < 5; i++) {
    sharedNeurons.push({
      type: "hidden" as const,
      uuid: `shared-${i}`,
      bias: 0.1,
      squash: "TANH" as const,
    });
  }

  // 5 unique neurons for creature A
  const uniqueNeuronsA = [];
  for (let i = 0; i < 5; i++) {
    uniqueNeuronsA.push({
      type: "hidden" as const,
      uuid: `unique-a-${i}`,
      bias: 0.1,
      squash: "TANH" as const,
    });
  }

  // Connect inputs to first shared neuron
  synapsesA.push({ fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 });

  // Chain shared neurons
  for (let i = 0; i < 4; i++) {
    synapsesA.push({
      fromUUID: `shared-${i}`,
      toUUID: `shared-${i + 1}`,
      weight: 0.5,
    });
  }

  // Connect to unique neurons
  synapsesA.push({
    fromUUID: "shared-4",
    toUUID: "unique-a-0",
    weight: 0.5,
  });

  for (let i = 0; i < 4; i++) {
    synapsesA.push({
      fromUUID: `unique-a-${i}`,
      toUUID: `unique-a-${i + 1}`,
      weight: 0.5,
    });
  }

  // Connect to output
  synapsesA.push({
    fromUUID: "unique-a-4",
    toUUID: "output-0",
    weight: 0.5,
  });

  const creatureA = Creature.fromJSON({
    neurons: [
      ...sharedNeurons,
      ...uniqueNeuronsA,
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: synapsesA,
    input: 3,
    output: 1,
  });
  creatureA.validate();

  // Create creature B with same shared neurons but different unique neurons
  const uniqueNeuronsB = [];
  for (let i = 0; i < 5; i++) {
    uniqueNeuronsB.push({
      type: "hidden" as const,
      uuid: `unique-b-${i}`,
      bias: 0.1,
      squash: "TANH" as const,
    });
  }

  const synapsesB = [];
  synapsesB.push({ fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 });

  for (let i = 0; i < 4; i++) {
    synapsesB.push({
      fromUUID: `shared-${i}`,
      toUUID: `shared-${i + 1}`,
      weight: 0.5,
    });
  }

  synapsesB.push({
    fromUUID: "shared-4",
    toUUID: "unique-b-0",
    weight: 0.5,
  });

  for (let i = 0; i < 4; i++) {
    synapsesB.push({
      fromUUID: `unique-b-${i}`,
      toUUID: `unique-b-${i + 1}`,
      weight: 0.5,
    });
  }

  synapsesB.push({
    fromUUID: "unique-b-4",
    toUUID: "output-0",
    weight: 0.5,
  });

  const creatureB = Creature.fromJSON({
    neurons: [
      ...sharedNeurons,
      ...uniqueNeuronsB,
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: synapsesB,
    input: 3,
    output: 1,
  });
  creatureB.validate();

  // Both creatures have 10 hidden neurons each, 5 are shared
  // Compatibility should be 5/10 = 0.5
  const compatibility = geneticCompatibility(creatureA, creatureB);
  assertAlmostEquals(
    compatibility,
    0.5,
    0.0001,
    `Genetic compatibility should be 0.5 (50% overlap), was: ${compatibility}`,
  );
});

/**
 * Issue #1033: Test asymmetric set sizes for Set intersection optimisation.
 * Ensures correct behaviour when one creature has more hidden neurons than the other.
 */
Deno.test("Genetic Compatibility asymmetric sizes", () => {
  // Create small creature with 3 hidden neurons
  const smallCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "shared-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "shared-1", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-small-0", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 },
      { fromUUID: "shared-0", toUUID: "shared-1", weight: 0.5 },
      { fromUUID: "shared-1", toUUID: "unique-small-0", weight: 0.5 },
      { fromUUID: "unique-small-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });
  smallCreature.validate();

  // Create large creature with 6 hidden neurons (including the 2 shared)
  const largeCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "shared-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "shared-1", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-large-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-large-1", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-large-2", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-large-3", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 },
      { fromUUID: "shared-0", toUUID: "shared-1", weight: 0.5 },
      { fromUUID: "shared-1", toUUID: "unique-large-0", weight: 0.5 },
      { fromUUID: "unique-large-0", toUUID: "unique-large-1", weight: 0.5 },
      { fromUUID: "unique-large-1", toUUID: "unique-large-2", weight: 0.5 },
      { fromUUID: "unique-large-2", toUUID: "unique-large-3", weight: 0.5 },
      { fromUUID: "unique-large-3", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });
  largeCreature.validate();

  // Small creature has 3 hidden neurons, 2 are shared with large creature
  // Compatibility = 2/3 ≈ 0.667
  const compatibility = geneticCompatibility(smallCreature, largeCreature);
  assertAlmostEquals(
    compatibility,
    2 / 3,
    0.0001,
    `Genetic compatibility should be 2/3 (asymmetric sizes), was: ${compatibility}`,
  );

  // Test in reverse order - should give same result
  const compatibilityReverse = geneticCompatibility(
    largeCreature,
    smallCreature,
  );
  assertAlmostEquals(
    compatibilityReverse,
    2 / 3,
    0.0001,
    `Genetic compatibility should be same regardless of order, was: ${compatibilityReverse}`,
  );
});
