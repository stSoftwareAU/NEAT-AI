import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
} from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { handleGrafting } from "../../src/architecture/GeneticIsolation.ts";

const testDir = ".test/GeneticIsolatedIslands";
emptyDirSync(testDir);

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
      { type: "output", uuid: "output-0", bias: 1, squash: "TANH" },
      { type: "output", uuid: "output-1", bias: 0, squash: "TANH" },
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
  CreatureUtil.makeUUID(creature);
  Deno.writeTextFileSync(
    `${testDir}/${uuidPrefix}.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  return creature;
}

Deno.test("GeneticIsolatedIslands", () => {
  const mother = makeTestCreature("mother");
  const father = makeTestCreature("father");

  const targetNeuronUUID = "output-0";
  const targetNeuronConnectionsBefore = father.exportJSON().synapses.filter(
    (synapse) => synapse.toUUID === targetNeuronUUID,
  );
  const totalWeightBefore = targetNeuronConnectionsBefore.reduce(
    (sum, synapse) => sum + Math.abs(synapse.weight),
    0,
  );

  const baby = handleGrafting(father, mother, father);
  
  assert(baby, "Baby should be created");
  const babyUUID = CreatureUtil.makeUUID(baby);
  const fatherUUID = CreatureUtil.makeUUID(father);
  const motherUUID = CreatureUtil.makeUUID(mother);
  assertNotEquals(
    babyUUID,
    fatherUUID,
    "Baby should not be a clone of the father",
  );
  assertNotEquals(
    babyUUID,
    motherUUID,
    "Baby should not be a clone of the mother",
  );
  const exportBaby = baby.exportJSON();

  Deno.writeTextFileSync(
    `${testDir}/baby.json`,
    JSON.stringify(exportBaby, null, 2),
  );

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
  assertAlmostEquals(
    totalWeightAfter,
    totalWeightBefore,
    0.0000001,
    `Sum of absolute weights to neuron ${targetNeuronUUID} should remain the same after grafting`,
  );

  baby.validate();
});

Deno.test("GeneticIsolatedIslands - Non-Overlapping UUIDs", () => {
  const mother = makeTestCreature("mother-unique");
  const father = makeTestCreature("father-unique");

  // Filter out predictable UUIDs (e.g., "output-0", "output-1")
  const excludeUUIDs = new Set(["input-0", "input-1","input-2","output-0", "output-1"]);
  const motherNeuronUUIDs = new Set(
    mother.neurons.map((n) => n.uuid).filter((uuid) => !excludeUUIDs.has(uuid))
  );
  const fatherNeuronUUIDs = new Set(
    father.neurons.map((n) => n.uuid).filter((uuid) => !excludeUUIDs.has(uuid))
  );

  // Check that there is no overlap in the remaining UUIDs
  const overlap = [...motherNeuronUUIDs].filter((uuid) =>
    fatherNeuronUUIDs.has(uuid)
  );
  assertEquals(overlap.length, 0, "Parents should have non-overlapping neuron UUIDs");

  // Create the baby
  const baby = handleGrafting(father, mother, father);
  assert(baby, "Baby should be created");

  // Validate that baby has neurons from both parents despite non-overlapping UUIDs
  const babyNeuronUUIDs = new Set(baby.neurons.map((n) => n.uuid));
  const motherContribution = [...babyNeuronUUIDs].filter((uuid) =>
    motherNeuronUUIDs.has(uuid)
  );
  const fatherContribution = [...babyNeuronUUIDs].filter((uuid) =>
    fatherNeuronUUIDs.has(uuid)
  );

  assert(
    motherContribution.length > 0,
    "Baby should include neurons from the mother despite non-overlapping UUIDs"
  );
  assert(
    fatherContribution.length > 0,
    "Baby should include neurons from the father despite non-overlapping UUIDs"
  );

  const exportBaby = baby.exportJSON();

  Deno.writeTextFileSync(
    `${testDir}/baby-unique.json`,
    JSON.stringify(exportBaby, null, 2),
  );
});

Deno.test("GeneticIsolatedIslands - Fallback Merging for Non-Overlapping UUIDs", () => {
  const mother = makeTestCreature("mother-unique");
  const father = makeTestCreature("father-unique");

  // Filter predictable UUIDs
  const excludeUUIDs = new Set(["input-0", "input-1", "input-2", "output-0", "output-1"]);
  const motherNeuronUUIDs = new Set(
    mother.neurons.map((n) => n.uuid).filter((uuid) => !excludeUUIDs.has(uuid))
  );
  const fatherNeuronUUIDs = new Set(
    father.neurons.map((n) => n.uuid).filter((uuid) => !excludeUUIDs.has(uuid))
  );

  // Check there is no overlap in hidden neurons
  const overlap = [...motherNeuronUUIDs].filter((uuid) => fatherNeuronUUIDs.has(uuid));
  assertEquals(overlap.length, 0, "Parents should have non-overlapping neuron UUIDs");

  // Adjusted Grafting: Allow fallback for non-overlapping neurons
  const baby = handleGrafting(father, mother, father);
  assert(baby, "Baby should be created");

  // Ensure baby contains contributions from both parents
  const babyNeuronUUIDs = new Set(baby.neurons.map((n) => n.uuid));
  const motherContribution = [...babyNeuronUUIDs].filter((uuid) =>
    motherNeuronUUIDs.has(uuid)
  );
  const fatherContribution = [...babyNeuronUUIDs].filter((uuid) =>
    fatherNeuronUUIDs.has(uuid)
  );

  assert(
    motherContribution.length > 0,
    "Baby should include neurons from the mother despite non-overlapping UUIDs"
  );
  assert(
    fatherContribution.length > 0,
    "Baby should include neurons from the father despite non-overlapping UUIDs"
  );

  // Write the result to verify structure
  const exportBaby = baby.exportJSON();
  Deno.writeTextFileSync(
    `${testDir}/baby-fallback.json`,
    JSON.stringify(exportBaby, null, 2),
  );
});
