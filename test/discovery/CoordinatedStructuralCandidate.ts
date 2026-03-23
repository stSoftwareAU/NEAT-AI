import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

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
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
      { fromUUID: "input-0", toId: -1, weight: 0.5 },
    ],
  };
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
        toNeuronId: 5000,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: 5000,
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
    s.fromId === 0 && s.toId === 5000
  );
  assertExists(trusted);
  assertEquals(trusted.weight, 0.9);

  // Downstream synapse preserved.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === 5000 && s.toId === -1 && s.weight === 0.25
    ),
    true,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: applying twice is safe (idempotent)", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronId: 0,
        toNeuronId: 5000,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: 5000,
        weight: 0.9,
      },
    ],
  };

  const once = applyCoordinatedStructuralCandidate(creature, candidate);
  const twice = applyCoordinatedStructuralCandidate(once, candidate);

  const syn1 = once.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
  );
  const syn2 = twice.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
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
    synapses: [{ fromUUID: "input-0", toId: -1, weight: 0.25 }],
    memetic: {
      generation: 1,
      score: 123,
      biases: {},
      weights: {
        0: [{ toId: -1, weight: 0.99 }],
      },
    },
  };
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
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  // Attempt to add a back-connection output -> hidden (fromIndex > toIndex).
  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "addSynapse",
        fromNeuronId: -1,
        toNeuronId: 5000,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();
  assertEquals(
    exported.synapses.some((s) => s.fromId === -1 && s.toId === 5000),
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
    synapses: [{ fromUUID: "input-0", toId: -1, weight: 0.25 }],
  };
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
    synapses: [{ fromUUID: "input-0", toId: -1, weight: 0.25 }],
  };
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
      {
        type: "addNeuron",
        neuronId: 6000,
        neuronType: "hidden",
        squash: IDENTITY.NAME,
        bias: 0.0,
        insertBeforeNeuronId: "output-0" as unknown as number,
      },
      {
        type: "addSynapse",
        fromNeuronId: 0,
        toNeuronId: 6000,
        weight: 1.0,
      },
      {
        type: "addSynapse",
        fromNeuronId: 6000,
        toNeuronId: -1,
        weight: 0.5,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Neuron should exist and appear before output-0 in forward-only ordering.
  const idxHidden = exported.neurons.findIndex((n) => n.id === 76839481494);
  const idxOutput = exported.neurons.findIndex((n) => n.id === -1);
  assertEquals(idxHidden >= 0, true);
  assertEquals(idxOutput >= 0, true);
  assertEquals(idxHidden < idxOutput, true);

  // New synapses should exist.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === 0 && s.toId === 76839481494 &&
      s.weight === 1.0
    ),
    true,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromId === 76839481494 && s.toId === -1 &&
      s.weight === 0.5
    ),
    true,
  );
});

Deno.test("applyCoordinatedStructuralCandidate: removeNeuron deletes neuron and any connected synapses", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeNeuron",
        neuronId: 5000,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  assertEquals(exported.neurons.some((n) => n.id === 5000), false);
  assertEquals(
    exported.synapses.some((s) => s.fromId === 0 && s.toId === 5000),
    false,
  );
  assertEquals(
    exported.synapses.some((s) => s.fromId === 5000 && s.toId === -1),
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
      { fromUUID: "input-0", toId: 5000, weight: -0.001 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: 5000,
        weight: 0.006,
      },
    ],
    comment: "Adjust synapse weight: old=-0.001, new=0.006, delta=0.007",
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  const updated = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
  );
  assertExists(updated);
  assertEquals(updated.weight, 0.006);

  // Other synapse should be unchanged.
  const unchanged = exported.synapses.find((s) =>
    s.fromId === 5000 && s.toId === -1
  );
  assertExists(unchanged);
  assertEquals(unchanged.weight, 0.25);
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight is idempotent (applying twice is safe)", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: 5000,
        weight: 0.9,
      },
    ],
  };

  const once = applyCoordinatedStructuralCandidate(creature, candidate);
  const twice = applyCoordinatedStructuralCandidate(once, candidate);

  const syn1 = once.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
  );
  const syn2 = twice.exportJSON().synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
  );

  assertExists(syn1);
  assertExists(syn2);
  assertEquals(syn1.weight, 0.9);
  assertEquals(syn2.weight, 0.9);
});

Deno.test("applyCoordinatedStructuralCandidate: setWeight is no-op if synapse doesn't exist", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5000, weight: 0.2 },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
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
    s.fromId === 0 && s.toId === 5000
  );
  assertExists(unchanged1);
  assertEquals(unchanged1.weight, 0.2);

  const unchanged2 = exported.synapses.find((s) =>
    s.fromId === 5000 && s.toId === -1
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
        toId: 5000,
        weight: 0.2,
        type: "positive",
        tags: [{ name: "discovered", value: "true" }],
      },
      { fromUUID: "hidden-0", toId: -1, weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "setWeight",
        fromNeuronId: 0,
        toNeuronId: 5000,
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  const updated = exported.synapses.find((s) =>
    s.fromId === 0 && s.toId === 5000
  );
  assertExists(updated);
  assertEquals(updated.weight, 0.9);
  assertEquals(updated.type, "positive");
  assertExists(updated.tags);
  assertEquals(updated.tags.length, 1);
  assertEquals(updated.tags[0].name, "discovered");
  assertEquals(updated.tags[0].value, "true");
});
