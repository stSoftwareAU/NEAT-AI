import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { normaliseCreatureExport } from "../../src/architecture/NormaliseCreatureExport.ts";

// Integer IDs for neurons used in these tests (from UUID hashing):
// hidden-0 = 1775329651, output-0 = -1

const ID_HIDDEN_0 = 1775329651;

function makeBase1(
  extraSynapses?: { fromId: number; toId: number; weight: number }[],
): CreatureExport {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      ...(extraSynapses ?? []),
    ],
  };
  normaliseCreatureExport(json);
  return json;
}

Deno.test("applyCoordinatedStructuralCandidate: remove/remove/add updates synapses as a single ordered ablation", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: -1,
      },
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Noisy input->output removed.
  assertEquals(
    exported.synapses.some((s) => s.fromId === 0 && s.toId === -1),
    false,
  );

  // Trusted input->hidden re-added with new weight.
  const trusted = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  assertExists(trusted);
  assertEquals(trusted.weight, 0.9);

  // Downstream synapse preserved.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === ID_HIDDEN_0 && s.toId === -1 && s.weight === 0.25
    ),
    true,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: applying twice is safe (idempotent)", () => {
  const base = makeBase1();
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.9,
      },
    ],
  };

  const once = applyCoordinatedStructuralCandidate(creature, candidate);
  const twice = applyCoordinatedStructuralCandidate(once, candidate);

  const syn1 = once.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  const syn2 = twice.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );

  assertExists(syn1);
  assertExists(syn2);
  assertEquals(syn1.weight, 0.9);
  assertEquals(syn2.weight, 0.9);
});

Deno.test("applyCoordinatedStructuralCandidate: removeSynapse deletes memetic when referenced", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
    memetic: {
      generation: 1,
      score: 123,
      biases: {},
      weights: {
        0: [{ toId: -1, weight: 0.99 }],
      },
    },
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: -1,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const after = mutated.exportJSON();
  assertEquals(after.memetic, undefined);
});

Deno.test("applyCoordinatedStructuralCandidate: forward-only rejects back-connections (addSynapse is skipped)", () => {
  const base = makeBase1();
  const creature = Creature.fromJSON(base);

  // Attempt to add a back-connection output -> hidden (fromIndex > toIndex).
  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "addSynapse",
        fromNeuronId: -1,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();
  assertEquals(
    exported.synapses.some((s) => s.fromId === -1 && s.toId === ID_HIDDEN_0),
    false,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: empty operations is a no-op returning the same creature", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0,
    operations: [],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  assertEquals(mutated, creature);
});

Deno.test("applyCoordinatedStructuralCandidate: addNeuron can insert before a target so forward-only addSynapse is valid", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  // Use a specific neuronId for the new neuron; insertBeforeNeuronId=-1 (output)
  const newNeuronId = 6000;
  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: -1,
      },
      {
        type: "addNeuron",
        neuronId: newNeuronId,
        neuronType: "hidden",
        squash: IDENTITY.NAME,
        bias: 0.0,
        insertBeforeNeuronId: -1,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: newNeuronId,
        weight: 1.0,
      },
      {
        type: "addSynapse",
        fromNeuronId: newNeuronId,
        toNeuronId: -1,
        weight: 0.5,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Neuron should exist and appear before output-0 in forward-only ordering.
  // The actual id assigned may differ from the requested newNeuronId (it gets a UUID-based id).
  // Find the hidden neuron generically.
  const hiddenNeuron = exported.neurons.find((n) => n.type === "hidden");
  assertExists(hiddenNeuron, "A hidden neuron should have been added");
  const actualHiddenId = hiddenNeuron.id!;

  const idxHidden = exported.neurons.findIndex((n) => n.id === actualHiddenId);
  const idxOutput = exported.neurons.findIndex((n) => n.id === -1);
  assertEquals(idxHidden >= 0, true);
  assertEquals(idxOutput >= 0, true);
  assertEquals(idxHidden < idxOutput, true);

  // New synapses should exist.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === 0 && s.toId === actualHiddenId &&
      s.weight === 1.0
    ),
    true,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === actualHiddenId && s.toId === -1 &&
      s.weight === 0.5
    ),
    true,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: removeNeuron deletes neuron and any connected synapses", () => {
  const base = makeBase1();
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeNeuron",
        neuronId: ID_HIDDEN_0,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  assertEquals(exported.neurons.some((n) => n.id === ID_HIDDEN_0), false);
  assertEquals(
    exported.synapses.some((s) => s.fromId === 0 && s.toId === ID_HIDDEN_0),
    false,
  );
  assertEquals(
    exported.synapses.some((s) => s.fromId === ID_HIDDEN_0 && s.toId === -1),
    false,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight updates existing synapse weight", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.001 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.006,
      },
    ],
    comment: "Adjust synapse weight: old=-0.001, new=0.006, delta=0.007",
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  const updated = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  assertExists(updated);
  assertEquals(updated.weight, 0.006);

  // Other synapse should be unchanged.
  const unchanged = exported.synapses.find((s) =>
    s.fromId === ID_HIDDEN_0 && s.toId === -1
  );
  assertExists(unchanged);
  assertEquals(unchanged.weight, 0.25);
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight is idempotent (applying twice is safe)", () => {
  const base = makeBase1();
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.9,
      },
    ],
  };

  const once = applyCoordinatedStructuralCandidate(creature, candidate);
  const twice = applyCoordinatedStructuralCandidate(once, candidate);

  const syn1 = once.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  const syn2 = twice.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );

  assertExists(syn1);
  assertExists(syn2);
  assertEquals(syn1.weight, 0.9);
  assertEquals(syn2.weight, 0.9);
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight is no-op if synapse doesn't exist", () => {
  const base = makeBase1();
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: -1,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Synapse should not exist (wasn't in original).
  assertEquals(
    exported.synapses.some((s) => s.fromId === 0 && s.toId === -1),
    false,
  );

  // Existing synapses should be unchanged.
  const unchanged1 = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  assertExists(unchanged1);
  assertEquals(unchanged1.weight, 0.2);

  const unchanged2 = exported.synapses.find((s) =>
    s.fromId === ID_HIDDEN_0 && s.toId === -1
  );
  assertExists(unchanged2);
  assertEquals(unchanged2.weight, 0.25);
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight preserves synapse metadata (type/tags)", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.2,
        type: "positive",
        tags: [{ name: "discovered", value: "true" }],
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  normaliseCreatureExport(base);
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: ID_HIDDEN_0,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  const updated = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === ID_HIDDEN_0
  );
  assertExists(updated);
  assertEquals(updated.weight, 0.9);
  assertEquals(updated.type, "positive");
  assertExists(updated.tags);
  assertEquals(updated.tags.length, 1);
  assertEquals(updated.tags[0].name, "discovered");
  assertEquals(updated.tags[0].value, "true");
});
