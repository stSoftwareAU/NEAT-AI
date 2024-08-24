import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createCompatibleFather } from "../../src/breed/Father.ts";
import type { SynapseExport } from "../../src/architecture/SynapseInterfaces.ts";
import type { NeuronExport } from "../../src/architecture/NeuronInterfaces.ts";

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

  // Add a new neuron and synapse in both mother and father that should also match
  const newNeuron: NeuronExport = {
    type: "hidden",
    uuid: "father-new",
    squash: "TANH",
    bias: 4,
  };
  father.neurons.push(newNeuron);
  mother.neurons.push({ ...newNeuron, uuid: "mother-new" });

  father.synapses.push({
    fromUUID: "father-3",
    toUUID: "father-new",
    weight: 0.2,
  });
  mother.synapses.push({
    fromUUID: "mother-3",
    toUUID: "mother-new",
    weight: 0.2,
  });

  // Expected outcome
  const fatherExpected = JSON.parse(JSON.stringify(father));
  fatherExpected.neurons[0].uuid = "mother-3"; // The original change
  fatherExpected.neurons[4].uuid = "mother-new"; // The new matching neuron

  fatherExpected.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID === "father-3") synapse.fromUUID = "mother-3";
    if (synapse.toUUID === "father-3") synapse.toUUID = "mother-3";
    if (synapse.fromUUID === "father-new") synapse.fromUUID = "mother-new";
    if (synapse.toUUID === "father-new") synapse.toUUID = "mother-new";
  });

  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(fatherActual, fatherExpected);
});

Deno.test("Genetic Integrity - No Matching Neurons", () => {
  const father = makeFather();
  const mother = makeMother();

  // Modify mother so none of its neurons match father's structure
  mother.synapses = mother.synapses.map((synapse) => ({
    ...synapse,
    weight: synapse.weight * -1, // Change the weight to prevent matching
  }));

  // The expected output should be the same as the original father since no neurons match
  const fatherExpected = JSON.parse(JSON.stringify(father));
  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(fatherActual, fatherExpected);
});
