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
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
      },
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-0",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-0",
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Noisy input->output removed.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "output-0"
    ),
    false,
  );

  // Trusted input->hidden re-added with new weight.
  const trusted = exported.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0"
  );
  assertExists(trusted);
  assertEquals(trusted.weight, 0.9);

  // Downstream synapse preserved.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-0" && s.toUUID === "output-0" && s.weight === 0.25
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
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.123,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-0",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-0",
        weight: 0.9,
      },
    ],
  };

  const once = applyCoordinatedStructuralCandidate(creature, candidate);
  const twice = applyCoordinatedStructuralCandidate(once, candidate);

  const syn1 = once.exportJSON().synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0"
  );
  const syn2 = twice.exportJSON().synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0"
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
        "input-0": [{ toUUID: "output-0", weight: 0.99 }],
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
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
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
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
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
        fromNeuronUuid: "output-0",
        toNeuronUuid: "hidden-0",
        weight: 0.9,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "output-0" && s.toUUID === "hidden-0"
    ),
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
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
      },
      {
        type: "addNeuron",
        neuronUuid: "hidden-inserted",
        neuronType: "hidden",
        squash: IDENTITY.NAME,
        bias: 0.0,
        insertBeforeNeuronUuid: "output-0",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-inserted",
        weight: 1.0,
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "hidden-inserted",
        toNeuronUuid: "output-0",
        weight: 0.5,
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  // Neuron should exist and appear before output-0 in forward-only ordering.
  const idxHidden = exported.neurons.findIndex((n) =>
    n.uuid === "hidden-inserted"
  );
  const idxOutput = exported.neurons.findIndex((n) => n.uuid === "output-0");
  assertEquals(idxHidden >= 0, true);
  assertEquals(idxOutput >= 0, true);
  assertEquals(idxHidden < idxOutput, true);

  // New synapses should exist.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "hidden-inserted" &&
      s.weight === 1.0
    ),
    true,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-inserted" && s.toUUID === "output-0" &&
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
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(base);

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [
      {
        type: "removeNeuron",
        neuronUuid: "hidden-0",
      },
    ],
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  assertEquals(exported.neurons.some((n) => n.uuid === "hidden-0"), false);
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "hidden-0"
    ),
    false,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-0" && s.toUUID === "output-0"
    ),
    false,
  );
});
