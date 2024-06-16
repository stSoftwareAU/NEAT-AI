import { assert, assertNotEquals } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { handleGeneticIsolation } from "../../src/architecture/GeneticIsolation,.ts";

const testDir = ".test/GeneticIsolatedIslands";
emptyDirSync(testDir);

async function makeTestCreature(uuidPrefix: string): Promise<Creature> {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `${uuidPrefix}-000`, bias: 0.1 },
      { type: "hidden", uuid: `${uuidPrefix}-001`, bias: -0.9 },
      { type: "hidden", uuid: `${uuidPrefix}-002`, bias: 0.1 },
      { type: "hidden", uuid: `${uuidPrefix}-003`, bias: -0.8 },
      { type: "hidden", uuid: `${uuidPrefix}-004`, bias: 0.1 },
      { type: "hidden", uuid: `${uuidPrefix}-005`, bias: 0 },
      { type: "hidden", uuid: `${uuidPrefix}-006`, bias: 0.1 },
      { type: "output", uuid: "output-0", bias: 1 },
      { type: "output", uuid: "output-1", bias: 0 },
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
  const creature = Creature.fromJSON(json);
  creature.validate();
  await CreatureUtil.makeUUID(creature);
  Deno.writeTextFileSync(
    `${testDir}/${uuidPrefix}.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  return creature;
}

Deno.test("GeneticIsolatedIslands", async () => {
  const mother = await makeTestCreature("mother");
  const father = await makeTestCreature("father");

  const baby = await handleGeneticIsolation(father, mother, father);
  assert(baby, "Baby should be created");
  const exportBaby = baby.exportJSON();

  Deno.writeTextFileSync(
    `${testDir}/baby.json`,
    JSON.stringify(exportBaby, null, 2),
  );

  baby.validate();

  const babyUUID = await CreatureUtil.makeUUID(baby);

  assertNotEquals(
    babyUUID,
    father.uuid,
    "Baby should not be a clone of the father",
  );
  assertNotEquals(
    babyUUID,
    mother.uuid,
    "Baby should not be a clone of the mother",
  );

  // Check that the baby has neurons from both parents
  const babyNeurons = new Set(baby.neurons.filter(neuron=>neuron.type==='hidden').map((neuron) => neuron.uuid));
  console.log(babyNeurons);
  const mumNeurons = new Set(mother.neurons.filter(neuron=>neuron.type==='hidden').map((neuron) => neuron.uuid));
  const dadNeurons = new Set(father.neurons.filter(neuron=>neuron.type==='hidden').map((neuron) => neuron.uuid));

  let motherNeuronCount = 0;
  let fatherNeuronCount = 0;
  babyNeurons.forEach((neuronUUID) => {
    if (mumNeurons.has(neuronUUID)) {
      motherNeuronCount++;
    }
    if (dadNeurons.has(neuronUUID)) {
      fatherNeuronCount++;
    }
  });

  assert(
    motherNeuronCount > 0,
    "Baby should have neurons from the mother",
  );
  assert(
    fatherNeuronCount > 0,
    "Baby should have neurons from the father",
  );

  
  // Validate that the total weight is maintained
  exportBaby.neurons.forEach((neuron) => {
    const inwardConnections = exportBaby.synapses.filter((synapse) =>
      synapse.toUUID === neuron.uuid
    );
    const totalWeight = inwardConnections.reduce(
      (sum, synapse) => sum + Math.abs(synapse.weight),
      0,
    );
    assert(
      totalWeight <= 1,
      `Total weight for neuron ${neuron.uuid} should be maintained`,
    );
  });
});