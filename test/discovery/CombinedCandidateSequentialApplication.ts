/**
 * Tests for sequential application of discovery candidates.
 *
 * Verifies that when combining "add" and "remove" operations,
 * newly added elements are NOT incorrectly removed.
 *
 * Bug scenario:
 * - "add-neurons" runs before "remove-neuron" (alphabetical sorting)
 * - Remove logic compares creature (with new neurons) to candidate (built from base)
 * - New neurons incorrectly identified as "removed" because they're not in candidate
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

/**
 * Creates a base creature with known structure for testing.
 */
function makeTestCreature() {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-C", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.5 },
      { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 0.3 },
      { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 0.3 },
      { fromUUID: "hidden-C", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: add-neurons + remove-neuron preserves added neurons",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create "add-neurons" candidate: adds hidden-D
    const addNeuronsJSON = structuredClone(baseJSON);
    const outputIndex = addNeuronsJSON.neurons.findIndex((n) =>
      n.type === "output"
    );
    addNeuronsJSON.neurons.splice(outputIndex, 0, {
      type: "hidden",
      uuid: "hidden-D",
      squash: "TANH",
      bias: 0.15,
    });
    addNeuronsJSON.synapses.push(
      { fromUUID: "input-0", toUUID: "hidden-D", weight: 0.4 },
      { fromUUID: "hidden-D", toUUID: "output-0", weight: 0.4 },
    );
    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D neuron",
      },
    };

    // Create "remove-neuron" candidate: removes hidden-C
    const removeNeuronJSON = structuredClone(baseJSON);
    removeNeuronJSON.neurons = removeNeuronJSON.neurons.filter(
      (n) => n.uuid !== "hidden-C",
    );
    removeNeuronJSON.synapses = removeNeuronJSON.synapses.filter(
      (s) => s.fromUUID !== "hidden-C" && s.toUUID !== "hidden-C",
    );
    // Reconnect A and B directly to output
    removeNeuronJSON.synapses.push(
      { fromUUID: "hidden-A", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.3 },
    );
    const removeNeuronCreature = Creature.fromJSON(removeNeuronJSON);
    delete removeNeuronCreature.uuid;
    removeNeuronCreature.fix();
    CreatureUtil.makeUUID(removeNeuronCreature);

    const removeNeuronCandidate: DiscoveryCandidate = {
      creature: removeNeuronCreature,
      change: {
        type: "remove-neuron",
        description: "Removed hidden-C neuron",
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeNeuronCandidate],
    );

    // Should have at least one combined candidate
    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo-successful candidate
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const neuronUUIDs = hiddenNeurons.map((n) => n.uuid);

    // Critical assertion: hidden-D (added) should exist
    assertEquals(
      neuronUUIDs.includes("hidden-D"),
      true,
      `Added neuron hidden-D should be preserved. Found neurons: ${
        neuronUUIDs.join(", ")
      }`,
    );

    // hidden-C (removed) should NOT exist
    assertEquals(
      neuronUUIDs.includes("hidden-C"),
      false,
      `Removed neuron hidden-C should not exist. Found neurons: ${
        neuronUUIDs.join(", ")
      }`,
    );

    // Original neurons A and B should still exist
    assertEquals(
      neuronUUIDs.includes("hidden-A"),
      true,
      "Original neuron hidden-A should exist",
    );
    assertEquals(
      neuronUUIDs.includes("hidden-B"),
      true,
      "Original neuron hidden-B should exist",
    );

    // Final expected structure: A, B, D (not C)
    assertEquals(
      hiddenNeurons.length,
      3,
      `Should have 3 hidden neurons (A, B, D). Found: ${
        neuronUUIDs.join(", ")
      }`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-synapses + remove-synapse preserves added synapses",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create "add-synapses" candidate: adds input-1 -> hidden-A synapse
    const addSynapsesJSON = structuredClone(baseJSON);
    addSynapsesJSON.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-A",
      weight: 0.35,
    });
    const addSynapsesCreature = Creature.fromJSON(addSynapsesJSON);
    delete addSynapsesCreature.uuid;
    addSynapsesCreature.fix();
    CreatureUtil.makeUUID(addSynapsesCreature);

    const addSynapsesCandidate: DiscoveryCandidate = {
      creature: addSynapsesCreature,
      change: {
        type: "add-synapses",
        description: "Added input-1 -> hidden-A synapse",
      },
    };

    // Create "remove-synapse" candidate: removes hidden-A -> hidden-C synapse
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromUUID === "hidden-A" && s.toUUID === "hidden-C"),
    );
    // Reconnect hidden-A directly to output
    removeSynapseJSON.synapses.push({
      fromUUID: "hidden-A",
      toUUID: "output-0",
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-A -> hidden-C synapse",
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addSynapsesCandidate, removeSynapseCandidate],
    );

    // Should have at least one combined candidate
    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo-successful candidate
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    const synapseKeys = comboJSON.synapses.map((s) =>
      `${s.fromUUID}->${s.toUUID}`
    );

    // Critical assertion: added synapse should exist
    assertEquals(
      synapseKeys.includes("input-1->hidden-A"),
      true,
      `Added synapse input-1->hidden-A should be preserved. Found synapses: ${
        synapseKeys.join(", ")
      }`,
    );

    // Removed synapse should NOT exist
    assertEquals(
      synapseKeys.includes("hidden-A->hidden-C"),
      false,
      `Removed synapse hidden-A->hidden-C should not exist. Found synapses: ${
        synapseKeys.join(", ")
      }`,
    );
  },
);
