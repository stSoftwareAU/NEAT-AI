import { assert, assertEquals, assertThrows } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  applySplitSynapseInsertNeuronCandidate,
  type SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("split-synapse-insert-neuron: removes old synapse and inserts neuron + 2 synapses", () => {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.25,
        type: "positive",
      },
    ],
  };

  const creature = Creature.fromJSON(base);
  creature.activate(new Float32Array([1]));

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
      {
        from_uuid: "hidden-split-0",
        to_uuid: "output-0",
        weight: -0.75,
        type: "condition",
      },
    ],
    expectedCreatureScoreGain: 0.123,
  };

  const mutated = applySplitSynapseInsertNeuronCandidate(creature, candidate);
  const exported: CreatureExport = mutated.exportJSON();

  assertEquals(exported.neurons.length, base.neurons.length + 1);
  assert(exported.neurons.some((n) => n.uuid === "hidden-split-0"));

  // Remove 1 synapse, add 2 => net +1.
  assertEquals(exported.synapses.length, base.synapses.length + 1);

  // Original synapse must be gone.
  assertEquals(
    exported.synapses.filter((s) =>
      s.fromUUID === "input-0" && s.toUUID === "output-0"
    ).length,
    0,
  );

  // Two new synapses must exist with the requested weights/types.
  const inToHidden = exported.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-split-0"
  );
  const hiddenToOut = exported.synapses.find((s) =>
    s.fromUUID === "hidden-split-0" && s.toUUID === "output-0"
  );
  assert(inToHidden);
  assert(hiddenToOut);
  assertEquals(inToHidden.weight, 0.5);
  assertEquals(hiddenToOut.weight, -0.75);
  assertEquals(hiddenToOut.type, "condition");

  // Neuron must be inserted before the original target neuron.
  const outIndex = exported.neurons.findIndex((n) => n.uuid === "output-0");
  const hiddenIndex = exported.neurons.findIndex((n) =>
    n.uuid === "hidden-split-0"
  );
  assert(hiddenIndex >= 0 && outIndex >= 0);
  assert(hiddenIndex < outIndex);

  // Mutated creature still activates (ordering must remain valid).
  mutated.activate(new Float32Array([1]));

  // Re-applying the same candidate should fail cleanly (idempotency).
  assertThrows(() =>
    applySplitSynapseInsertNeuronCandidate(mutated, candidate)
  );
});
