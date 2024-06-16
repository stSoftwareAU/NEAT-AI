import { assert, assertNotEquals } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";

async function makeMum() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "island-mum-000", squash: "IDENTITY", bias: 0.1 },
      {
        type: "hidden",
        uuid: "island-mum-001",
        squash: "IDENTITY",
        bias: -0.9,
      },
      { type: "hidden", uuid: "island-mum-002", squash: "IDENTITY", bias: 0.1 },
      {
        type: "hidden",
        uuid: "island-mum-003",
        squash: "IDENTITY",
        bias: -0.8,
      },
      { type: "hidden", uuid: "island-mum-004", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "island-mum-005", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "island-mum-006", squash: "IDENTITY", bias: 0.1 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 1 },
      { type: "output", squash: "IDENTITY", uuid: "output-1", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "island-mum-002", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "island-mum-000", weight: -0.3 },
      { fromUUID: "island-mum-000", toUUID: "island-mum-001", weight: 0.3 },
      { fromUUID: "island-mum-001", toUUID: "island-mum-002", weight: 0.3 },
      { fromUUID: "island-mum-002", toUUID: "island-mum-003", weight: 0.6 },
      { fromUUID: "island-mum-003", toUUID: "island-mum-004", weight: 0.31 },
      { fromUUID: "island-mum-004", toUUID: "island-mum-005", weight: 0.33 },
      { fromUUID: "island-mum-005", toUUID: "island-mum-006", weight: 0.33 },
      { fromUUID: "island-mum-004", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "island-mum-006", toUUID: "output-0", weight: 0.32 },
      { fromUUID: "island-mum-000", toUUID: "output-0", weight: -0.35 },
      { fromUUID: "island-mum-000", toUUID: "output-1", weight: 0.36 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  await CreatureUtil.makeUUID(creature);
  Deno.writeTextFileSync(
    `${testDir}/mum.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  return creature;
}

async function makeDad() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "island-dad-000", squash: "IDENTITY", bias: 0.1 },
      {
        type: "hidden",
        uuid: "island-dad-001",
        squash: "IDENTITY",
        bias: -0.9,
      },
      { type: "hidden", uuid: "island-dad-002", squash: "IDENTITY", bias: 0.1 },
      {
        type: "hidden",
        uuid: "island-dad-003",
        squash: "IDENTITY",
        bias: -0.8,
      },
      { type: "hidden", uuid: "island-dad-004", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "island-dad-005", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "island-dad-006", squash: "IDENTITY", bias: 0.1 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 1 },
      { type: "output", squash: "IDENTITY", uuid: "output-1", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "island-dad-002", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "island-dad-000", weight: -0.3 },
      { fromUUID: "island-dad-000", toUUID: "island-dad-001", weight: 0.3 },
      { fromUUID: "island-dad-001", toUUID: "island-dad-002", weight: 0.3 },
      { fromUUID: "island-dad-002", toUUID: "island-dad-003", weight: 0.6 },
      { fromUUID: "island-dad-003", toUUID: "island-dad-004", weight: 0.31 },
      { fromUUID: "island-dad-004", toUUID: "island-dad-005", weight: 0.33 },
      { fromUUID: "island-dad-005", toUUID: "island-dad-006", weight: 0.33 },
      { fromUUID: "island-dad-004", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "island-dad-006", toUUID: "output-0", weight: 0.32 },
      { fromUUID: "island-dad-000", toUUID: "output-0", weight: -0.35 },
      { fromUUID: "island-dad-000", toUUID: "output-1", weight: 0.36 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  await CreatureUtil.makeUUID(creature);
  Deno.writeTextFileSync(
    `${testDir}/dad.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  return creature;
}

const testDir = ".test/GeneticIsolatedIslands";
ensureDirSync(testDir);

Deno.test("GeneticIsolatedIslands", async () => {
  const mum = await makeMum();
  const dad = await makeDad();

  const baby = await Offspring.breed(mum, dad);
  assert(baby, "Baby should be created");

  const babyUUID = await CreatureUtil.makeUUID(baby);
  Deno.writeTextFileSync(
    `${testDir}/baby.json`,
    JSON.stringify(baby.exportJSON(), null, 2),
  );
  assertNotEquals(
    babyUUID,
    dad.uuid,
    "Baby should not be a clone of the father",
  );
  assertNotEquals(
    babyUUID,
    mum.uuid,
    "Baby should not be a clone of the mother",
  );

  // Check that the baby has neurons from both parents
  const babyNeurons = new Set(baby.neurons.map((neuron) => neuron.uuid));
  const mumNeurons = new Set(mum.neurons.map((neuron) => neuron.uuid));
  const dadNeurons = new Set(dad.neurons.map((neuron) => neuron.uuid));

  let mumNeuronCount = 0;
  let dadNeuronCount = 0;
  babyNeurons.forEach((neuronUUID) => {
    if (mumNeurons.has(neuronUUID)) {
      mumNeuronCount++;
    }
    if (dadNeurons.has(neuronUUID)) {
      dadNeuronCount++;
    }
  });

  assert(
    mumNeuronCount > 0,
    "Baby should have neurons from the mother",
  );
  assert(
    dadNeuronCount > 0,
    "Baby should have neurons from the father",
  );
});
