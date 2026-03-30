import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createCompatibleFather } from "@breed/Father.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { stripNumericIdsFromCreatureExport } from "@creature/CreatureSerialization.ts";
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

  // Build expected: normalise a fresh copy of father, then remap father-3's id to mother-3's id.
  // createCompatibleFather normalises father in-place and returns a new object with remapped ids.
  const fatherForExpected = makeFather();
  normaliseCreatureExport(fatherForExpected);

  // father-3 (id=987686466) gets remapped to mother-3 (id=159393431)
  const fatherThreeId = 987686466;
  const motherThreeId = 159393431;

  const fatherExpected = JSON.parse(JSON.stringify(fatherForExpected));
  // Remap neuron id and uuid
  fatherExpected.neurons[0].id = motherThreeId;
  fatherExpected.neurons[0].uuid = "mother-3";
  // Remap synapse fromId/toId and fromUUID/toUUID
  fatherExpected.synapses.forEach((synapse: Record<string, unknown>) => {
    if (synapse.fromId === fatherThreeId) {
      synapse.fromId = motherThreeId;
      synapse.fromUUID = "mother-3";
    }
    if (synapse.toId === fatherThreeId) {
      synapse.toId = motherThreeId;
      synapse.toUUID = "mother-3";
    }
  });

  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(
    fatherActual,
    stripNumericIdsFromCreatureExport(fatherExpected as CreatureExport),
  );
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

  // The expected output should be the same as the original father since "father-3" is used elsewhere.
  // createCompatibleFather normalises father in-place, so we normalise a fresh copy for expected.
  const fatherForExpected = makeFather();
  fatherForExpected.synapses.push({
    fromUUID: "hidden-4",
    toUUID: "father-3",
    weight: 0.9,
  });
  normaliseCreatureExport(fatherForExpected);
  const fatherExpected = JSON.parse(JSON.stringify(fatherForExpected));

  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(
    fatherActual,
    stripNumericIdsFromCreatureExport(fatherExpected as CreatureExport),
  );
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

  // Build expected: normalise a fresh copy of father (with new neuron), then remap father-3 → mother-3.
  const fatherForExpected = makeFather();
  const newNeuronForExpected: NeuronExport = {
    type: "hidden",
    uuid: "father-new",
    squash: "TANH",
    bias: 4,
  };
  const outputIdxForExpected = fatherForExpected.neurons.findIndex((n) =>
    n.type === "output"
  );
  fatherForExpected.neurons.splice(
    outputIdxForExpected,
    0,
    newNeuronForExpected,
  );
  fatherForExpected.synapses.push({
    fromUUID: "input-1",
    toUUID: "father-new",
    weight: 0.2,
  });
  fatherForExpected.synapses.push({
    fromUUID: "father-new",
    toUUID: "output-0",
    weight: 0.21,
  });
  normaliseCreatureExport(fatherForExpected);

  const fatherThreeId = 987686466;
  const motherThreeId = 159393431;

  const fatherExpected = JSON.parse(JSON.stringify(fatherForExpected));
  // Remap father-3 → mother-3 in neurons (id and uuid)
  fatherExpected.neurons[0].id = motherThreeId;
  fatherExpected.neurons[0].uuid = "mother-3";
  // Remap synapse fromId/toId and fromUUID/toUUID
  fatherExpected.synapses.forEach((synapse: Record<string, unknown>) => {
    if (synapse.fromId === fatherThreeId) {
      synapse.fromId = motherThreeId;
      synapse.fromUUID = "mother-3";
    }
    if (synapse.toId === fatherThreeId) {
      synapse.toId = motherThreeId;
      synapse.toUUID = "mother-3";
    }
  });

  const fatherActual = createCompatibleFather(mother, father);

  assertEquals(
    fatherActual,
    stripNumericIdsFromCreatureExport(fatherExpected as CreatureExport),
  );
});

Deno.test("Consistent key generation with shuffled synapses", () => {
  // Issue #1444: Verify that synapse order does not affect the key map output.
  // This ensures the consolidated key generation is order-independent.
  const father: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "father-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "father-b", squash: "TANH", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "father-a", weight: 0.5 },
      { fromUUID: "father-a", toUUID: "father-b", weight: 0.5 },
      { fromUUID: "father-b", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "father-b", toUUID: "output-1", weight: 0.5 },
    ],
    input: 2,
    output: 2,
  };

  const mother: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "mother-a", squash: "TANH", bias: 0.15 },
      { type: "hidden", uuid: "mother-b", squash: "TANH", bias: 0.25 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "mother-a", weight: 0.6 },
      { fromUUID: "mother-a", toUUID: "mother-b", weight: 0.6 },
      { fromUUID: "mother-b", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "mother-b", toUUID: "output-1", weight: 0.6 },
    ],
    input: 2,
    output: 2,
  };

  // Get result with original synapse order
  const result1 = createCompatibleFather(mother, father);

  // Create copies with reversed synapse order
  const fatherReversed: CreatureExport = {
    ...father,
    synapses: [...father.synapses].reverse(),
  };
  const motherReversed: CreatureExport = {
    ...mother,
    synapses: [...mother.synapses].reverse(),
  };

  // Reversed synapse order should produce the same UUID mapping
  const result2 = createCompatibleFather(motherReversed, fatherReversed);

  // Both results should have the same neuron ids (the mapping should be identical)
  assertEquals(result1.neurons.length, result2.neurons.length);
  for (let i = 0; i < result1.neurons.length; i++) {
    assertEquals(result1.neurons[i].uuid, result2.neurons[i].uuid);
  }

  // Both should create valid creatures
  Creature.fromJSON(result1).validate();
  Creature.fromJSON(result2).validate();
});

Deno.test(
  "createCompatibleFather — UUID alignment is index-independent; parent-only UUIDs are fine",
  () => {
    // Mother and father list the same shared hidden in different array positions
    // and use different runtime ids for that uuid (simulates divergent loads).
    // Each parent also has a hidden uuid the other lacks — normal for breeding.
    // Parent-only hidden neurons must differ in connectivity from each other, otherwise
    // connectivity-key matching would merge them (UUID alignment does not run for
    // uuids present in only one parent).
    const mother: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      neurons: [
        {
          type: "hidden",
          uuid: "only-m",
          squash: "IDENTITY",
          bias: 0,
          id: 9_001_001,
        },
        {
          type: "hidden",
          uuid: "shared-bridge",
          squash: "IDENTITY",
          bias: 0,
          id: 9_001_002,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "only-m", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "shared-bridge", weight: 0.2 },
        { fromUUID: "only-m", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "shared-bridge", toUUID: "output-0", weight: 0.4 },
      ],
    };

    const father: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      neurons: [
        {
          type: "hidden",
          uuid: "shared-bridge",
          squash: "IDENTITY",
          bias: 0,
          id: 9_002_002,
        },
        {
          type: "hidden",
          uuid: "only-f",
          squash: "IDENTITY",
          bias: 0,
          id: 9_002_003,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "only-f", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "only-f", weight: 0.55 },
        { fromUUID: "input-1", toUUID: "shared-bridge", weight: 0.6 },
        { fromUUID: "only-f", toUUID: "output-0", weight: 0.7 },
        { fromUUID: "shared-bridge", toUUID: "output-0", weight: 0.8 },
      ],
    };

    const adjusted = createCompatibleFather(mother, father);
    Creature.fromJSON(adjusted).validate();

    const uuids = new Set(
      adjusted.neurons
        .filter((n) => n.type === "hidden")
        .map((n) => n.uuid),
    );
    assertEquals(uuids.has("shared-bridge"), true);
    assertEquals(uuids.has("only-f"), true);
    assertEquals(uuids.has("only-m"), false);
  },
);

Deno.test("Genetic Integrity - No Matching Neurons", () => {
  const father = makeFather();
  Creature.fromJSON(father).validate();

  // Create a mother with structurally different neurons so no topology matches.
  // The original mother-3 is connected input-0 → mother-3 → hidden-4 → outputs.
  // To prevent matching father-3 (input-0 → father-3 → hidden-4 → outputs),
  // we change mother-3's inbound to come from input-1 instead of input-0.
  const nonMatchingMother = makeMother();
  // Replace the inbound synapse for mother-3 to use a different input
  nonMatchingMother.synapses = nonMatchingMother.synapses.map((s) => {
    if (
      (s as unknown as Record<string, unknown>).fromUUID === "input-0" &&
      (s as unknown as Record<string, unknown>).toUUID === "mother-3"
    ) {
      return {
        ...(s as unknown as Record<string, unknown>),
        fromUUID: "input-1",
      } as typeof s;
    }
    return s;
  });
  Creature.fromJSON(nonMatchingMother).validate();

  // The expected output should be the same as the original father since no neurons match.
  // createCompatibleFather normalises father in-place, so we normalise a fresh copy for expected.
  const fatherForExpected = makeFather();
  normaliseCreatureExport(fatherForExpected);
  const fatherExpected = JSON.parse(JSON.stringify(fatherForExpected));

  const fatherActual = createCompatibleFather(nonMatchingMother, father);

  Creature.fromJSON(fatherActual).validate();
  assertEquals(
    stripNumericIdsFromCreatureExport(fatherActual),
    stripNumericIdsFromCreatureExport(fatherExpected),
  );
});
