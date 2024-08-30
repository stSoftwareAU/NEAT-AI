import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createCompatibleFather } from "../../src/breed/Father.ts";
import type { SynapseExport } from "../../src/architecture/SynapseInterfaces.ts";
import type { NeuronExport } from "../../src/architecture/NeuronInterfaces.ts";
import { Creature } from "../../mod.ts";

function makeFather() {
  const creature: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "father-3", squash: "Cosine", bias: 3 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "father-3", weight: -0.3 },

      { fromUUID: "father-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };

  return creature;
}

function makeMother() {
  const creature: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "mother-3", squash: "LeakyReLU", bias: 3.1 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "mother-3", weight: -0.31 },

      { fromUUID: "mother-3", toUUID: "hidden-4", weight: -0.51 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.61 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.71 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.81 },
    ],
    input: 3,
    output: 2,
  };

  return creature;
}

Deno.test("CompatibleFather", () => {
  const father = makeFather();
  const mother = makeMother();
  const fatherExpected = JSON.parse(JSON.stringify(father));
  fatherExpected.neurons[0].uuid = "mother-3";
  fatherExpected.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID === "father-3") synapse.fromUUID = "mother-3";
  });
  fatherExpected.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.toUUID === "father-3") synapse.toUUID = "mother-3";
  });
  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(fatherActual, fatherExpected);
});

Deno.test("Genetic Integrity - No Changes When Neuron UUID Used Elsewhere", () => {
  const father = makeFather();
  const mother = makeMother();

  // Modify father so that the UUID "father-3" is used elsewhere in a different context
  father.synapses.push({
    fromUUID: "hidden-4",
    toUUID: "father-3",
    weight: 0.9,
  });

  // The expected output should be the same as the original father since "father-3" is used elsewhere
  const fatherExpected = JSON.parse(JSON.stringify(father));
  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(fatherActual, fatherExpected);
});

Deno.test("Genetic Integrity - Multiple Matching Neurons", () => {
  const father = makeFather();
  const mother = makeMother();

  // Add a new hidden neuron and corresponding synapse in both mother and father
  const newNeuron: NeuronExport = {
    type: "hidden",
    uuid: "father-new",
    squash: "TANH",
    bias: 4,
  };

  // Insert the new hidden neuron before the output neurons
  const outputNeuronIndexFather = father.neurons.findIndex((n) =>
    n.type === "output"
  );
  father.neurons.splice(outputNeuronIndexFather, 0, newNeuron);

  const outputNeuronIndexMother = mother.neurons.findIndex((n) =>
    n.type === "output"
  );
  mother.neurons.splice(outputNeuronIndexMother, 0, {
    ...newNeuron,
    uuid: "mother-new",
  });

  // Add corresponding synapses
  father.synapses.push({
    fromUUID: "input-1",
    toUUID: "father-new",
    weight: 0.2,
  });
  father.synapses.push({
    fromUUID: "father-new",
    toUUID: "output-0",
    weight: 0.21,
  });

  Creature.fromJSON(father).validate();

  mother.synapses.push({
    fromUUID: "input-0",
    toUUID: "mother-new",
    weight: 0.2,
  });

  mother.synapses.push({
    fromUUID: "mother-new",
    toUUID: "output-0",
    weight: 0.21,
  });
  Creature.fromJSON(mother).validate();

  // Expected outcome
  const fatherExpected = JSON.parse(JSON.stringify(father));

  // Apply changes to match the mother's neuron UUIDs in the expected output
  fatherExpected.neurons[0].uuid = "mother-3"; // The original change
  // fatherExpected.neurons[outputNeuronIndexFather].uuid = "mother-new"; // The new matching neuron

  fatherExpected.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID === "father-3") synapse.fromUUID = "mother-3";
    if (synapse.toUUID === "father-3") synapse.toUUID = "mother-3";
  });

  const fatherActual = createCompatibleFather(mother, father);

  // Ensure that the actual result matches the expected result
  assertEquals(fatherActual, fatherExpected);
});

Deno.test("Genetic Integrity - No Matching Neurons", () => {
  const father = makeFather();
  Creature.fromJSON(father).validate();

  const nonMatchingMother = makeMother();
  nonMatchingMother.neurons.unshift({
    type: "hidden",
    uuid: "hidden-0",
    squash: "TANH",
    bias: 1.2,
  });

  nonMatchingMother.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID === "input-0") {
      synapse.fromUUID = "hidden-0";
    }
    // if( synapse.toUUID === "mother-3" ) synapse.toUUID = "hidden-0";
  });
  nonMatchingMother.synapses.push({
    fromUUID: "input-0",
    toUUID: "hidden-0",
    weight: -1.3,
  });
  console.info(nonMatchingMother);
  Creature.fromJSON(nonMatchingMother).validate();

  // Create a distinct mother with non-matching neurons and synapses
  //   const nonMatchingMother = JSON.parse(JSON.stringify(nonMatchingMother));

  //   // Modify the UUIDs of the mother's neurons to ensure no matching neurons
  //   nonMatchingMother.neurons = nonMatchingMother.neurons.map(
  //     (neuron: NeuronExport) => {
  //       if (
  //         !neuron.uuid.startsWith("input-") && !neuron.uuid.startsWith("output-")
  //       ) {
  //         return { ...neuron, uuid: neuron.uuid + "-different" };
  //       }
  //       return neuron;
  //     },
  //   );

  //   // Update the synapses in the mother to reflect the new neuron UUIDs
  //   nonMatchingMother.synapses = nonMatchingMother.synapses.map(
  //     (synapse: SynapseExport) => {
  //       let newFromUUID = synapse.fromUUID;
  //       let newToUUID = synapse.toUUID;

  //       if (
  //         !synapse.fromUUID.startsWith("input-") &&
  //         !synapse.fromUUID.startsWith("output-")
  //       ) {
  //         newFromUUID = synapse.fromUUID + "-different";
  //       }

  //       if (
  //         !synapse.toUUID.startsWith("input-") &&
  //         !synapse.toUUID.startsWith("output-")
  //       ) {
  //         newToUUID = synapse.toUUID + "-different";
  //       }

  //       return {
  //         ...synapse,
  //         fromUUID: newFromUUID,
  //         toUUID: newToUUID,
  //       };
  //     },
  //   );

  Creature.fromJSON(nonMatchingMother).validate();

  // The expected output should be the same as the original father since no neurons match
  const fatherExpected = JSON.parse(JSON.stringify(father));
  const fatherActual = createCompatibleFather(nonMatchingMother, father);

  Creature.fromJSON(fatherActual).validate();
  assertEquals(fatherActual, fatherExpected);
});
