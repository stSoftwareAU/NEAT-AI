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
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  return creature;
}

Deno.test("Genetic Compatibily Zero percent", () => {
  const parent = makeTestCreature("parent");
  const target = makeTestCreature("target");

  const compatibily = geneticCompatibility(parent, target);
  assert(
    compatibily === 0,
    `Genetic compatibility should be 0 was: ${compatibily}`,
  );
});

Deno.test("Genetic Compatibily 100 percent", () => {
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

  const compatibily = geneticCompatibility(parent, target);
  assertAlmostEquals(
    compatibily,
    1,
    0.0001,
    `Genetic compatibility should be 1 was: ${compatibily}`,
  );
});
