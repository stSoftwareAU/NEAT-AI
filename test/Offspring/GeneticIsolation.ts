import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { handleGrafting } from "../../src/architecture/GeneticIsolation.ts";

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

  const targetNeuronUUID = "output-0";
  const targetNeuronConnectionsBefore = father.exportJSON().synapses.filter(
    (synapse) => synapse.toUUID === targetNeuronUUID,
  );
  const totalWeightBefore = targetNeuronConnectionsBefore.reduce(
    (sum, synapse) => sum + Math.abs(synapse.weight),
    0,
  );

  const baby = await handleGrafting(father, mother, father);
  assert(baby, "Baby should be created");
  const exportBaby = baby.exportJSON();

  Deno.writeTextFileSync(
    `${testDir}/baby.json`,
    JSON.stringify(exportBaby, null, 2),
  );

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
  const babyNeurons = new Set(
    baby.neurons.filter((neuron) => neuron.type === "hidden").map((neuron) =>
      neuron.uuid
    ),
  );

  const mumNeurons = new Set(
    mother.neurons.filter((neuron) => neuron.type === "hidden").map((neuron) =>
      neuron.uuid
    ),
  );
  const dadNeurons = new Set(
    father.neurons.filter((neuron) => neuron.type === "hidden").map((neuron) =>
      neuron.uuid
    ),
  );

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

  // Validate that the baby has unique neurons (no duplicates)
  const uniqueBabyNeurons = new Set(baby.neurons.map((neuron) => neuron.uuid));
  assertEquals(
    uniqueBabyNeurons.size,
    baby.neurons.length,
    "Baby should have unique neurons with no duplicates",
  );

  // Validate that all neurons, except input neurons, have outgoing synapses
  const neuronsWithOutgoingSynapses = new Set(
    exportBaby.synapses.map((synapse) => synapse.fromUUID),
  );
  baby.neurons.forEach((neuron) => {
    if (neuron.type !== "output" && neuron.type !== "input") {
      assert(
        neuronsWithOutgoingSynapses.has(neuron.uuid),
        `Neuron ${neuron.uuid} should have outgoing synapses`,
      );
    }
  });

  // Validate that output neurons are the last neurons
  const outputNeuronsStartIndex = baby.neurons.findIndex(
    (neuron) => neuron.type === "output",
  );
  if (outputNeuronsStartIndex !== -1) {
    for (let i = outputNeuronsStartIndex; i < baby.neurons.length; i++) {
      assertEquals(
        baby.neurons[i].type,
        "output",
        "All neurons after the first output neuron should also be output neurons",
      );
    }
  }

  // Validate that the order of neurons is "forward only"
  const neuronUUIDToIndex = new Map(
    baby.neurons.map((neuron, index) => [neuron.uuid, index]),
  );
  exportBaby.synapses.forEach((synapse) => {
    const fromIndex = neuronUUIDToIndex.get(synapse.fromUUID);
    const toIndex = neuronUUIDToIndex.get(synapse.toUUID);
    assert(
      fromIndex !== undefined && toIndex !== undefined,
      `Synapse from ${synapse.fromUUID} to ${synapse.toUUID} should have defined indexes`,
    );
    assert(
      fromIndex! < toIndex!,
      `Synapse from ${synapse.fromUUID} (${fromIndex}) to ${synapse.toUUID} (${toIndex}) should be forward only`,
    );
  });

  // Validate the sum of absolute weights remains the same
  const targetNeuronConnectionsAfter = baby.exportJSON().synapses.filter(
    (synapse) => synapse.toUUID === targetNeuronUUID,
  );
  const totalWeightAfter = targetNeuronConnectionsAfter.reduce(
    (sum, synapse) => sum + Math.abs(synapse.weight),
    0,
  );
  assertEquals(
    totalWeightAfter,
    totalWeightBefore,
    `Sum of absolute weights to neuron ${targetNeuronUUID} should remain the same after grafting`,
  );

  baby.validate();
});
