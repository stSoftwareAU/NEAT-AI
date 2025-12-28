import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
  };
  return Creature.fromJSON(base);
}

Deno.test("buildCombinedFromSuccessful skips split-synapse candidates with missing spec", () => {
  const baseCreature = makeBaseCreature();

  // A valid add-synapses candidate (adds one synapse to a hidden neuron we also add).
  const withHidden: CreatureExport = baseCreature.exportJSON();
  withHidden.neurons = [
    { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
    ...withHidden.neurons,
  ];
  withHidden.synapses = [
    ...withHidden.synapses,
    { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
    { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
  ];
  const addSynapsesCandidate: DiscoveryCandidate = {
    creature: Creature.fromJSON(withHidden),
    change: { type: "add-synapses", description: "test add-synapses" },
  };

  // A malformed split candidate (type says split, but spec field is missing).
  // This should be ignored by applyChangeToCreature.
  const brokenSplitCandidate: DiscoveryCandidate = {
    creature: baseCreature,
    change: {
      type: "split-synapse-insert-neuron",
      description: "test split missing spec",
    },
  };

  const combos = buildCombinedFromSuccessful(baseCreature, "discovery-test", [
    addSynapsesCandidate,
    brokenSplitCandidate,
  ]);

  // Only one candidate can be applied, so no combos should be emitted.
  assertEquals(combos.length, 0);
});
