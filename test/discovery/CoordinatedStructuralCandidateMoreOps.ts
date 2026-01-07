import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

Deno.test(
  "applyCoordinatedStructuralCandidate: addNeuron updates an existing neuron (idempotent replay)",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
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
          type: "addNeuron",
          neuronUuid: "hidden-0",
          neuronType: "hidden",
          squash: TANH.NAME,
          bias: 0.5,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    const neuron = exported.neurons.find((n) => n.uuid === "hidden-0");
    assertEquals(neuron?.squash, TANH.NAME);
    assertEquals(neuron?.bias, 0.5);
    assertEquals(exported.neurons.length, base.neurons.length);
  },
);

Deno.test(
  "applyCoordinatedStructuralCandidate: addNeuron with missing insertBefore inserts before outputs for non-forward-only creatures",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: false,
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
          type: "addNeuron",
          neuronUuid: "hidden-appended",
          neuronType: "hidden",
          squash: IDENTITY.NAME,
          bias: 0.0,
          insertBeforeNeuronUuid: "does-not-exist",
        },
        // Keep the neuron alive: a lone hidden neuron will be removed by `fix()`.
        {
          type: "addSynapse",
          fromNeuronUuid: "input-0",
          toNeuronUuid: "hidden-appended",
          weight: 1.0,
        },
        {
          type: "addSynapse",
          fromNeuronUuid: "hidden-appended",
          toNeuronUuid: "output-0",
          weight: 0.5,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(exported.neurons.length, base.neurons.length + 1);
    assertEquals(exported.neurons.at(0)?.uuid, "hidden-appended");
    assertEquals(exported.neurons.at(1)?.uuid, "output-0");
    assertEquals(
      exported.synapses.some((s) =>
        s.fromUUID === "input-0" && s.toUUID === "hidden-appended" &&
        s.weight === 1.0
      ),
      true,
    );
    assertEquals(
      exported.synapses.some((s) =>
        s.fromUUID === "hidden-appended" && s.toUUID === "output-0" &&
        s.weight === 0.5
      ),
      true,
    );
  },
);

Deno.test(
  "applyCoordinatedStructuralCandidate: changeSquash updates existing neuron squash",
  () => {
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
          type: "changeSquash",
          neuronUuid: "hidden-0",
          squash: TANH.NAME,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(
      exported.neurons.find((n) => n.uuid === "hidden-0")?.squash,
      TANH.NAME,
    );
  },
);

Deno.test(
  "applyCoordinatedStructuralCandidate: setBias updates existing neuron bias",
  () => {
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
          type: "setBias",
          neuronUuid: "hidden-0",
          bias: -0.25,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(
      exported.neurons.find((n) => n.uuid === "hidden-0")?.bias,
      -0.25,
    );
  },
);

Deno.test(
  "applyCoordinatedStructuralCandidate: removeNeuron is a no-op when neuron is missing",
  () => {
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
          neuronUuid: "missing-neuron",
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(exported.neurons.length, base.neurons.length);
    assertEquals(exported.synapses.length, base.synapses.length);
    assertEquals(
      exported.neurons.some((n) => n.uuid === "missing-neuron"),
      false,
    );
  },
);
