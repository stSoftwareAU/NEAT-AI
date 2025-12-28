import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  applySplitSynapseInsertNeuronCandidate,
  type SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("split-synapse-insert-neuron: cleans up memetic data referencing removed synapse", () => {
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

  // Confirm memetic is present before applying the candidate.
  const before = creature.exportJSON();
  assert(before.memetic);
  assertEquals(before.memetic.weights["input-0"][0].toUUID, "output-0");

  const candidate: SplitSynapseInsertNeuronCandidate = {
    type: "split_synapse_insert_neuron",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    oldWeight: 0.25,
    newNeuron: {
      uuid: "hidden-split-0",
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0.1,
    },
    newSynapses: [
      { from_uuid: "input-0", to_uuid: "hidden-split-0", weight: 0.5 },
      { from_uuid: "hidden-split-0", to_uuid: "output-0", weight: -0.75 },
    ],
    expectedCreatureScoreGain: 0.123,
  };

  const mutated = applySplitSynapseInsertNeuronCandidate(creature, candidate);
  const after = mutated.exportJSON();

  // Memetic data must be deleted because it referenced the removed synapse.
  assertEquals(after.memetic, undefined);
});
