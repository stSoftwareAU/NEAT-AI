/**
 * Tests for combined candidate synapse removal operations.
 *
 * Verifies that remove-synapse combinations correctly describe
 * synapses rather than neurons in their descriptions.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

/**
 * Creates a test creature with multiple synapses suitable for removal testing.
 */
function makeSynapseRemovalTestCreature() {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "hidden-B", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.2 },
      { fromUUID: "hidden-A", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.5 },
      // Extra synapses to remove (low-impact connections)
      { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 0.01 },
      { fromUUID: "hidden-B", toUUID: "hidden-A", weight: 0.02 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: remove-synapse combinations describe synapses not neurons",
  () => {
    // Bug: When appliedTypes contains only "remove-synapse", isRemovalOnly is true
    // and the function returns "Pruned N low-impact neurons" instead of "Removed N synapses"
    const base = makeSynapseRemovalTestCreature();
    const baseJSON = base.exportInternalJSON();

    // Create remove-synapse candidate 1: Remove hidden-A -> hidden-B synapse
    const removeSynapse1Json = structuredClone(baseJSON);
    removeSynapse1Json.synapses = removeSynapse1Json.synapses.filter(
      (s) => !(s.fromId === 1775329634 && s.toId === 1775329633),
    );
    const removeSynapse1Creature = Creature.fromJSON(removeSynapse1Json);
    delete removeSynapse1Creature.uuid;
    removeSynapse1Creature.fix();
    CreatureUtil.makeUUID(removeSynapse1Creature);

    const removeSynapse1Candidate: DiscoveryCandidate = {
      creature: removeSynapse1Creature,
      change: {
        type: "remove-synapse",
        description: "✂️ Removed synapse hidden-A -> hidden-B (impact: 1.5e-8)",
      },
    };

    // Create remove-synapse candidate 2: Remove hidden-B -> hidden-A synapse
    const removeSynapse2Json = structuredClone(baseJSON);
    removeSynapse2Json.synapses = removeSynapse2Json.synapses.filter(
      (s) => !(s.fromId === 1775329633 && s.toId === 1775329634),
    );
    const removeSynapse2Creature = Creature.fromJSON(removeSynapse2Json);
    delete removeSynapse2Creature.uuid;
    removeSynapse2Creature.fix();
    CreatureUtil.makeUUID(removeSynapse2Creature);

    const removeSynapse2Candidate: DiscoveryCandidate = {
      creature: removeSynapse2Creature,
      change: {
        type: "remove-synapse",
        description: "✂️ Removed synapse hidden-B -> hidden-A (impact: 2.3e-8)",
      },
    };

    // Build combined candidates from both remove-synapse candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [removeSynapse1Candidate, removeSynapse2Candidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo-successful candidate
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const desc = combo.change.description ?? "";

    // The description should mention synapses, NOT neurons
    // Bug: Currently returns "Pruned N low-impact neurons" due to isRemovalOnly short-circuit
    assert(
      desc.toLowerCase().includes("synapse"),
      `remove-synapse combinations should mention "synapses" in description, got: "${desc}"`,
    );

    // Should NOT say "neurons" when only synapses were removed
    assertEquals(
      desc.toLowerCase().includes("neuron"),
      false,
      `remove-synapse combinations should NOT mention "neurons", got: "${desc}"`,
    );
  },
);
