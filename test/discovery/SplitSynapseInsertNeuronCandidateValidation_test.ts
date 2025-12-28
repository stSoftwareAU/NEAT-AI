import { assertThrows } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  applySplitSynapseInsertNeuronCandidate,
  type SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [{
      uuid: "output-0",
      type: "output",
      squash: IDENTITY.NAME,
      bias: 0,
    }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
  };
  return Creature.fromJSON(base);
}

function makeCandidate(
  overrides: Partial<SplitSynapseInsertNeuronCandidate> = {},
): SplitSynapseInsertNeuronCandidate {
  return {
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
      { "from_uuid": "input-0", "to_uuid": "hidden-split-0", weight: 0.5 },
      { "from_uuid": "hidden-split-0", "to_uuid": "output-0", weight: -0.75 },
    ],
    expectedCreatureScoreGain: 0.123,
    ...overrides,
  };
}

Deno.test("split-synapse validation: throws when creature is not forward-only ordered", () => {
  const bad: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    // Back-connection output -> hidden violates forward-only.
    synapses: [{ fromUUID: "output-0", toUUID: "hidden-0", weight: 1 }],
  };
  const creature = Creature.fromJSON(bad);
  assertThrows(() =>
    applySplitSynapseInsertNeuronCandidate(creature, makeCandidate())
  );
});

Deno.test("split-synapse validation: throws on oldWeight mismatch", () => {
  const creature = makeBaseCreature();
  assertThrows(() =>
    applySplitSynapseInsertNeuronCandidate(
      creature,
      makeCandidate({ oldWeight: 0.251 }),
    )
  );
});

Deno.test("split-synapse validation: throws when newNeuron UUID already exists", () => {
  const creature = makeBaseCreature();
  assertThrows(() =>
    applySplitSynapseInsertNeuronCandidate(
      creature,
      makeCandidate({
        newNeuron: {
          uuid: "output-0",
          type: "hidden",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      }),
    )
  );
});

Deno.test("split-synapse validation: throws when newSynapses endpoints are wrong", () => {
  const creature = makeBaseCreature();
  assertThrows(() =>
    applySplitSynapseInsertNeuronCandidate(
      creature,
      makeCandidate({
        newSynapses: [
          { "from_uuid": "input-0", "to_uuid": "output-0", weight: 1 },
          { "from_uuid": "output-0", "to_uuid": "hidden-split-0", weight: 1 },
        ],
      }),
    )
  );
});
