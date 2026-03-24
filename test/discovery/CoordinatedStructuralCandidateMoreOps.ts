import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { normaliseCreatureExport } from "../../src/architecture/NormaliseCreatureExport.ts";

// Integer IDs for neurons used in these tests (from UUID hashing):
// hidden-0 → 1775329651, output-0 → -1
const ID_HIDDEN_0 = 1775329651;

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
    normaliseCreatureExport(
      base as Parameters<typeof normaliseCreatureExport>[0],
    );
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "addNeuron",
          neuronId: ID_HIDDEN_0,
          neuronType: "hidden",
          squash: TANH.NAME,
          bias: 0.5,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    const neuron = exported.neurons.find((n) => n.id === ID_HIDDEN_0);
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
    normaliseCreatureExport(
      base as Parameters<typeof normaliseCreatureExport>[0],
    );
    const creature = Creature.fromJSON(base);

    // Use a fixed neuronId that won't conflict with existing neurons.
    const NEW_NEURON_ID = 6000;

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "addNeuron",
          neuronId: NEW_NEURON_ID,
          neuronType: "hidden",
          squash: IDENTITY.NAME,
          bias: 0.0,
          insertBeforeNeuronId: "does-not-exist" as unknown as number,
        },
        // Keep the neuron alive: a lone hidden neuron will be removed by `fix()`.
        {
          type: "addSynapse",
          fromNeuronId: 0,
          toNeuronId: NEW_NEURON_ID,
          weight: 1.0,
        },
        {
          type: "addSynapse",
          fromNeuronId: NEW_NEURON_ID,
          toNeuronId: -1,
          weight: 0.5,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    // New hidden neuron should be inserted before output (-1)
    assertEquals(exported.neurons.length, base.neurons.length + 1);
    assertEquals(exported.neurons.at(0)?.id, NEW_NEURON_ID);
    assertEquals(exported.neurons.at(1)?.id, -1);
    assertEquals(
      exported.synapses.some((s) =>
        s.fromId === 0 && s.toId === NEW_NEURON_ID &&
        s.weight === 1.0
      ),
      true,
    );
    assertEquals(
      exported.synapses.some((s) =>
        s.fromId === NEW_NEURON_ID && s.toId === -1 &&
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
    normaliseCreatureExport(
      base as Parameters<typeof normaliseCreatureExport>[0],
    );
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "changeSquash",
          neuronId: ID_HIDDEN_0,
          squash: TANH.NAME,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(
      exported.neurons.find((n) => n.id === ID_HIDDEN_0)?.squash,
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
    normaliseCreatureExport(
      base as Parameters<typeof normaliseCreatureExport>[0],
    );
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "setBias",
          neuronId: ID_HIDDEN_0,
          bias: -0.25,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(
      exported.neurons.find((n) => n.id === ID_HIDDEN_0)?.bias,
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
    normaliseCreatureExport(
      base as Parameters<typeof normaliseCreatureExport>[0],
    );
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "removeNeuron",
          neuronId: 7000, // Does not exist in the creature
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(exported.neurons.length, base.neurons.length);
    assertEquals(exported.synapses.length, base.synapses.length);
    assertEquals(
      exported.neurons.some((n) => n.id === 7000),
      false,
    );
  },
);
