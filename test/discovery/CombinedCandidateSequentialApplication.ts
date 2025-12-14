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
  "buildCombinedFromSuccessful: add-neurons targeting hidden neuron keeps new neuron before target",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create "add-neurons" candidate: adds hidden-D and targets hidden-A (a hidden neuron).
    // The new neuron must be inserted BEFORE hidden-A; otherwise hidden-A can't receive
    // hidden-D's activation during the forward pass.
    const addNeuronsJSON = structuredClone(baseJSON);
    const targetIndex = addNeuronsJSON.neurons.findIndex((n) =>
      n.uuid === "hidden-A"
    );
    assert(targetIndex >= 0, "Expected hidden-A to exist in base creature");

    addNeuronsJSON.neurons.splice(targetIndex, 0, {
      type: "hidden",
      uuid: "hidden-D",
      squash: "TANH",
      bias: 0.15,
    });
    addNeuronsJSON.synapses.push(
      { fromUUID: "input-0", toUUID: "hidden-D", weight: 0.4 },
      { fromUUID: "hidden-D", toUUID: "hidden-A", weight: 0.4 },
    );
    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D neuron targeting hidden-A",
      },
    };

    // Second candidate so buildCombinedFromSuccessful produces combinations.
    // Use remove-synapse to keep the structure change simple.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromUUID === "hidden-B" && s.toUUID === "hidden-C"),
    );
    // Reconnect hidden-B directly to output
    removeSynapseJSON.synapses.push({
      fromUUID: "hidden-B",
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
        description: "Removed hidden-B -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUUID: "hidden-B",
          toNeuronUUID: "hidden-C",
        },
      },
    };

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeSynapseCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    const indexOf = (uuid: string) =>
      comboJSON.neurons.findIndex((n) => n.uuid === uuid);

    const newIndex = indexOf("hidden-D");
    const targetHiddenIndex = indexOf("hidden-A");
    assert(newIndex >= 0, "Expected hidden-D to exist in combined creature");
    assert(
      targetHiddenIndex >= 0,
      "Expected hidden-A to exist in combined creature",
    );

    assert(
      newIndex < targetHiddenIndex,
      `Expected hidden-D (index ${newIndex}) to be before hidden-A (index ${targetHiddenIndex})`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-neurons chain keeps new neurons in candidate order (new -> new -> existing)",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create "add-neurons" candidate: adds hidden-D -> hidden-E -> hidden-A chain.
    //
    // Both hidden-D and hidden-E are new neurons. The merge logic must keep:
    // hidden-D before hidden-E before hidden-A, otherwise hidden-D -> hidden-E
    // becomes a backward edge and breaks forward-pass ordering.
    const addNeuronsJSON = structuredClone(baseJSON);
    const targetIndex = addNeuronsJSON.neurons.findIndex((n) =>
      n.uuid === "hidden-A"
    );
    assert(targetIndex >= 0, "Expected hidden-A to exist in base creature");

    // Insert the chain in the intended (candidate) order.
    addNeuronsJSON.neurons.splice(
      targetIndex,
      0,
      {
        type: "hidden",
        uuid: "hidden-D",
        squash: "TANH",
        bias: 0.11,
      },
      {
        type: "hidden",
        uuid: "hidden-E",
        squash: "TANH",
        bias: 0.12,
      },
    );

    addNeuronsJSON.synapses.push(
      { fromUUID: "input-0", toUUID: "hidden-D", weight: 0.4 },
      { fromUUID: "hidden-D", toUUID: "hidden-E", weight: 0.35 },
      { fromUUID: "hidden-E", toUUID: "hidden-A", weight: 0.3 },
    );

    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D -> hidden-E -> hidden-A chain",
      },
    };

    // Second candidate so buildCombinedFromSuccessful produces combinations.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromUUID === "hidden-A" && s.toUUID === "hidden-C"),
    );
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
        synapseDetails: {
          fromNeuronUUID: "hidden-A",
          toNeuronUUID: "hidden-C",
        },
      },
    };

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeSynapseCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    const indexOf = (uuid: string) =>
      comboJSON.neurons.findIndex((n) => n.uuid === uuid);

    const dIndex = indexOf("hidden-D");
    const eIndex = indexOf("hidden-E");
    const aIndex = indexOf("hidden-A");

    assert(dIndex >= 0, "Expected hidden-D to exist in combined creature");
    assert(eIndex >= 0, "Expected hidden-E to exist in combined creature");
    assert(aIndex >= 0, "Expected hidden-A to exist in combined creature");

    assert(
      dIndex < eIndex,
      `Expected hidden-D (index ${dIndex}) to be before hidden-E (index ${eIndex})`,
    );
    assert(
      eIndex < aIndex,
      `Expected hidden-E (index ${eIndex}) to be before hidden-A (index ${aIndex})`,
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
        synapseDetails: {
          fromNeuronUUID: "hidden-A",
          toNeuronUUID: "hidden-C",
        },
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

/**
 * Creates a test creature with multiple low-impact neurons for removal testing.
 */
function makeRemovalTestCreature() {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-C", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "hidden-D", squash: "IDENTITY", bias: 0.05 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.5 },
      { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 0.3 },
      { fromUUID: "hidden-B", toUUID: "hidden-D", weight: 0.3 },
      { fromUUID: "hidden-C", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-D", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: multiple remove-low-impact candidates are all applied",
  () => {
    const base = makeRemovalTestCreature();
    const baseJSON = base.exportJSON();

    // Verify base has A, B, C, D hidden neurons
    const baseHidden = baseJSON.neurons.filter((n) => n.type === "hidden");
    assertEquals(baseHidden.length, 4, "Base should have 4 hidden neurons");

    // Create 3 remove-low-impact candidates, each removing a different neuron
    // Candidate 1: Remove hidden-B
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.uuid !== "hidden-B",
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromUUID !== "hidden-B" && s.toUUID !== "hidden-B",
    );
    // Reconnect: input-1 now goes directly to hidden-D
    removeBJson.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-D",
      weight: 0.5,
    });
    const removeBCreature = Creature.fromJSON(removeBJson);
    delete removeBCreature.uuid;
    removeBCreature.fix();
    CreatureUtil.makeUUID(removeBCreature);

    const removeBCandidate: DiscoveryCandidate = {
      creature: removeBCreature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-B (impact: 1.14e-7)",
      },
    };

    // Candidate 2: Remove hidden-C
    const removeCJson = structuredClone(baseJSON);
    removeCJson.neurons = removeCJson.neurons.filter(
      (n) => n.uuid !== "hidden-C",
    );
    removeCJson.synapses = removeCJson.synapses.filter(
      (s) => s.fromUUID !== "hidden-C" && s.toUUID !== "hidden-C",
    );
    // Reconnect: hidden-A now goes directly to output
    removeCJson.synapses.push({
      fromUUID: "hidden-A",
      toUUID: "output-0",
      weight: 0.3,
    });
    const removeCCreature = Creature.fromJSON(removeCJson);
    delete removeCCreature.uuid;
    removeCCreature.fix();
    CreatureUtil.makeUUID(removeCCreature);

    const removeCCandidate: DiscoveryCandidate = {
      creature: removeCCreature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-C (impact: 3.46e-7)",
      },
    };

    // Candidate 3: Remove hidden-D
    const removeDJson = structuredClone(baseJSON);
    removeDJson.neurons = removeDJson.neurons.filter(
      (n) => n.uuid !== "hidden-D",
    );
    removeDJson.synapses = removeDJson.synapses.filter(
      (s) => s.fromUUID !== "hidden-D" && s.toUUID !== "hidden-D",
    );
    // Reconnect: hidden-B now goes directly to output
    removeDJson.synapses.push({
      fromUUID: "hidden-B",
      toUUID: "output-0",
      weight: 0.3,
    });
    const removeDCreature = Creature.fromJSON(removeDJson);
    delete removeDCreature.uuid;
    removeDCreature.fix();
    CreatureUtil.makeUUID(removeDCreature);

    const removeDCandidate: DiscoveryCandidate = {
      creature: removeDCreature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-D (impact: 5.72e-9)",
      },
    };

    // Build combined candidates from all 3 successful removals
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [removeBCandidate, removeCCandidate, removeDCandidate],
    );

    // Should produce combined candidate(s)
    assert(
      combined.length > 0,
      "Should produce combined candidates when multiple same-type removals succeed",
    );

    // Find the combo-successful candidate that combines all removals
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(
      combo,
      "Should have a combo-successful candidate combining all removals",
    );

    const comboJSON = combo.creature.exportJSON();
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const neuronUUIDs = hiddenNeurons.map((n) => n.uuid);

    // All three neurons (B, C, D) should be removed
    assertEquals(
      neuronUUIDs.includes("hidden-B"),
      false,
      `Removed neuron hidden-B should not exist. Found neurons: ${
        neuronUUIDs.join(", ")
      }`,
    );
    assertEquals(
      neuronUUIDs.includes("hidden-C"),
      false,
      `Removed neuron hidden-C should not exist. Found neurons: ${
        neuronUUIDs.join(", ")
      }`,
    );
    assertEquals(
      neuronUUIDs.includes("hidden-D"),
      false,
      `Removed neuron hidden-D should not exist. Found neurons: ${
        neuronUUIDs.join(", ")
      }`,
    );

    // Only hidden-A should remain
    assertEquals(
      neuronUUIDs.includes("hidden-A"),
      true,
      "Original neuron hidden-A should exist",
    );

    // Final expected structure: only A remains (B, C, D removed)
    assertEquals(
      hiddenNeurons.length,
      1,
      `Should have 1 hidden neuron (only A). Found: ${neuronUUIDs.join(", ")}`,
    );

    // Verify the description has good grammar for git commit message
    assert(
      combo.change.description?.includes("Pruned") ||
        combo.change.description?.includes("Removed"),
      `Description should use proper verb (Pruned/Removed): "${combo.change.description}"`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: descriptions use proper grammar for commit messages",
  () => {
    const base = makeRemovalTestCreature();
    const baseJSON = base.exportJSON();

    // Create add-synapses candidate
    const addSynapseJson = structuredClone(baseJSON);
    addSynapseJson.synapses.push({
      fromUUID: "input-0",
      toUUID: "hidden-B",
      weight: 0.3,
    });
    const addSynapseCreature = Creature.fromJSON(addSynapseJson);
    delete addSynapseCreature.uuid;
    addSynapseCreature.fix();
    CreatureUtil.makeUUID(addSynapseCreature);

    const addSynapseCandidate: DiscoveryCandidate = {
      creature: addSynapseCreature,
      change: {
        type: "add-synapses",
        description: "🔗 Added helpful synapse input-0 -> hidden-B",
      },
    };

    // Create change-squash candidate
    const changeSquashJson = structuredClone(baseJSON);
    const hiddenA = changeSquashJson.neurons.find((n) => n.uuid === "hidden-A");
    if (hiddenA) hiddenA.squash = "TANH";
    const changeSquashCreature = Creature.fromJSON(changeSquashJson);
    delete changeSquashCreature.uuid;
    changeSquashCreature.fix();
    CreatureUtil.makeUUID(changeSquashCreature);

    const changeSquashCandidate: DiscoveryCandidate = {
      creature: changeSquashCreature,
      change: {
        type: "change-squash",
        description: "🎨 Changed activation function for hidden-A",
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addSynapseCandidate, changeSquashCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");

    // Check that descriptions use proper English grammar
    for (const candidate of combined) {
      const desc = candidate.change.description ?? "";

      // Should NOT have awkward constructs like "Combined add-synapses + change-squash"
      assertEquals(
        desc.includes("add-synapses +") || desc.includes("+ change-squash"),
        false,
        `Description should not use raw type names with +: "${desc}"`,
      );

      // Should use proper verbs, not "Combined X changes"
      assertEquals(
        /Combined \d+ \w+-\w+ changes/.test(desc),
        false,
        `Description should not use "Combined N type-name changes": "${desc}"`,
      );

      // Should start with an emoji followed by a proper sentence
      assert(
        /^[\p{Emoji}]+ [A-Z]/u.test(desc),
        `Description should start with emoji then capital letter: "${desc}"`,
      );
    }
  },
);

Deno.test(
  "buildCombinedFromSuccessful: uses unique emojis for different combination types",
  () => {
    const base = makeRemovalTestCreature();
    const baseJSON = base.exportJSON();

    // Create multiple candidates of different types
    const candidates: DiscoveryCandidate[] = [];

    // Remove candidate 1
    const remove1Json = structuredClone(baseJSON);
    remove1Json.neurons = remove1Json.neurons.filter((n) =>
      n.uuid !== "hidden-B"
    );
    remove1Json.synapses = remove1Json.synapses.filter(
      (s) => s.fromUUID !== "hidden-B" && s.toUUID !== "hidden-B",
    );
    remove1Json.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-D",
      weight: 0.5,
    });
    const remove1Creature = Creature.fromJSON(remove1Json);
    delete remove1Creature.uuid;
    remove1Creature.fix();
    CreatureUtil.makeUUID(remove1Creature);
    candidates.push({
      creature: remove1Creature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-B",
      },
    });

    // Remove candidate 2
    const remove2Json = structuredClone(baseJSON);
    remove2Json.neurons = remove2Json.neurons.filter((n) =>
      n.uuid !== "hidden-C"
    );
    remove2Json.synapses = remove2Json.synapses.filter(
      (s) => s.fromUUID !== "hidden-C" && s.toUUID !== "hidden-C",
    );
    remove2Json.synapses.push({
      fromUUID: "hidden-A",
      toUUID: "output-0",
      weight: 0.3,
    });
    const remove2Creature = Creature.fromJSON(remove2Json);
    delete remove2Creature.uuid;
    remove2Creature.fix();
    CreatureUtil.makeUUID(remove2Creature);
    candidates.push({
      creature: remove2Creature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-C",
      },
    });

    // Add synapse candidate
    const addJson = structuredClone(baseJSON);
    addJson.synapses.push({
      fromUUID: "input-0",
      toUUID: "hidden-B",
      weight: 0.3,
    });
    const addCreature = Creature.fromJSON(addJson);
    delete addCreature.uuid;
    addCreature.fix();
    CreatureUtil.makeUUID(addCreature);
    candidates.push({
      creature: addCreature,
      change: {
        type: "add-synapses",
        description: "🔗 Added helpful synapse",
      },
    });

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      candidates,
    );

    assert(combined.length > 0, "Should produce combined candidates");

    // Pure removal combinations should use pruning emoji (✂️)
    // Note: ✂️ is U+2702 + U+FE0F (variation selector), match base char only
    // "Pruned N low-impact neurons" is a pure removal, "Restructured" is mixed
    const removalOnlyCombos = combined.filter((c) => {
      const desc = c.change.description?.toLowerCase() ?? "";
      // cspell:disable-next-line
      return desc.includes("pruned") && !desc.includes("restructur");
    });
    for (const combo of removalOnlyCombos) {
      // Check if description starts with scissors (✂ U+2702) or broom (🧹 U+1F9F9)
      const desc = combo.change.description ?? "";
      const startsWithScissors = desc.charCodeAt(0) === 0x2702; // ✂
      const startsWithBroom = desc.codePointAt(0) === 0x1F9F9; // 🧹
      assert(
        startsWithScissors || startsWithBroom,
        `Pure removal combinations should use pruning emoji (✂️ or 🧹): "${desc}"`,
      );
    }

    // Mixed combinations (removal + add) should use metamorphosis emoji (🦋)
    const mixedCombos = combined.filter((c) =>
      // cspell:disable-next-line
      c.change.description?.toLowerCase().includes("restructur")
    );
    for (const combo of mixedCombos) {
      const desc = combo.change.description ?? "";
      const startsWithButterfly = desc.codePointAt(0) === 0x1F98B; // 🦋
      assert(
        startsWithButterfly,
        `Mixed combinations should use metamorphosis emoji (🦋): "${desc}"`,
      );
    }

    // Verify we found at least some combinations to test
    assert(
      removalOnlyCombos.length > 0 || mixedCombos.length > 0,
      "Should have at least one testable combination",
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: reconnection synapses from input neurons are preserved",
  () => {
    // This test verifies that reconnection synapses originating from input neurons
    // (e.g., input-0 -> hidden-X) are correctly preserved when combining removal candidates.
    // Bug: remainingNeurons set was missing input neurons, causing these synapses to be dropped.

    const base = makeRemovalTestCreature();
    const baseJSON = base.exportJSON();

    // Verify base structure: input-1 -> hidden-B -> hidden-D -> output-0
    const baseSynapses = baseJSON.synapses.map((s) =>
      `${s.fromUUID}->${s.toUUID}`
    );
    assert(
      baseSynapses.includes("input-1->hidden-B"),
      "Base should have input-1->hidden-B synapse",
    );

    // Create removal candidate that removes hidden-B
    // The reconnection synapse goes FROM input-1 (an input neuron) TO hidden-D
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.uuid !== "hidden-B",
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromUUID !== "hidden-B" && s.toUUID !== "hidden-B",
    );
    // Critical reconnection synapse: input-1 -> hidden-D (bypasses removed hidden-B)
    removeBJson.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-D",
      weight: 0.5,
    });
    const removeBCreature = Creature.fromJSON(removeBJson);
    delete removeBCreature.uuid;
    removeBCreature.fix();
    CreatureUtil.makeUUID(removeBCreature);

    const removeBCandidate: DiscoveryCandidate = {
      creature: removeBCreature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-B (impact: 1.14e-7)",
      },
    };

    // Create another removal candidate that removes hidden-C
    // The reconnection synapse goes FROM hidden-A TO output-0
    const removeCJson = structuredClone(baseJSON);
    removeCJson.neurons = removeCJson.neurons.filter(
      (n) => n.uuid !== "hidden-C",
    );
    removeCJson.synapses = removeCJson.synapses.filter(
      (s) => s.fromUUID !== "hidden-C" && s.toUUID !== "hidden-C",
    );
    removeCJson.synapses.push({
      fromUUID: "hidden-A",
      toUUID: "output-0",
      weight: 0.3,
    });
    const removeCCreature = Creature.fromJSON(removeCJson);
    delete removeCCreature.uuid;
    removeCCreature.fix();
    CreatureUtil.makeUUID(removeCCreature);

    const removeCCandidate: DiscoveryCandidate = {
      creature: removeCCreature,
      change: {
        type: "remove-low-impact",
        description: "🪶 Removed neuron hidden-C (impact: 3.46e-7)",
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [removeBCandidate, removeCCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo that combines both removals
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    const comboSynapses = comboJSON.synapses.map((s) =>
      `${s.fromUUID}->${s.toUUID}`
    );

    // The critical assertion: reconnection synapse from input-1 should exist
    assert(
      comboSynapses.includes("input-1->hidden-D"),
      `Reconnection synapse from input neuron (input-1->hidden-D) should be preserved. ` +
        `Found synapses: ${comboSynapses.join(", ")}`,
    );

    // Also verify hidden-A->output-0 reconnection is preserved
    assert(
      comboSynapses.includes("hidden-A->output-0"),
      `Reconnection synapse (hidden-A->output-0) should be preserved. ` +
        `Found synapses: ${comboSynapses.join(", ")}`,
    );

    // Verify both neurons were removed
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const hiddenUUIDs = hiddenNeurons.map((n) => n.uuid);
    assertEquals(
      hiddenUUIDs.includes("hidden-B"),
      false,
      "hidden-B should be removed",
    );
    assertEquals(
      hiddenUUIDs.includes("hidden-C"),
      false,
      "hidden-C should be removed",
    );
  },
);

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
    const baseJSON = base.exportJSON();

    // Create remove-synapse candidate 1: Remove hidden-A -> hidden-B synapse
    const removeSynapse1Json = structuredClone(baseJSON);
    removeSynapse1Json.synapses = removeSynapse1Json.synapses.filter(
      (s) => !(s.fromUUID === "hidden-A" && s.toUUID === "hidden-B"),
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
      (s) => !(s.fromUUID === "hidden-B" && s.toUUID === "hidden-A"),
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
