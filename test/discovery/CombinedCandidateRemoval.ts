/**
 * Tests for combined candidate removal operations.
 *
 * Verifies that multiple removal candidates are correctly combined
 * and that descriptions use proper grammar for commit messages.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { normaliseCreatureExport } from "../../src/architecture/NormaliseCreatureExport.ts";

// Integer IDs for neurons used in these tests (from UUID hashing):
// hidden-A = 1775329634, hidden-B = 1775329633, hidden-C = 1775329632
// hidden-D = 1775329631, output-0 = -1

const ID_HIDDEN_A = 1775329634;
const ID_HIDDEN_B = 1775329633;
const ID_HIDDEN_C = 1775329632;
const ID_HIDDEN_D = 1775329631;

/**
 * Creates a test creature with multiple low-impact neurons for removal testing.
 */
function makeRemovalTestCreature() {
  const json = {
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
  };
  normaliseCreatureExport(
    json as Parameters<typeof normaliseCreatureExport>[0],
  );
  const creature = Creature.fromJSON(
    json as Parameters<typeof Creature.fromJSON>[0],
  );
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: multiple remove-low-impact candidates are all applied",
  () => {
    const base = makeRemovalTestCreature();
    const baseJSON = base.exportInternalJSON();

    // Verify base has A, B, C, D hidden neurons
    const baseHidden = baseJSON.neurons.filter((n) => n.type === "hidden");
    assertEquals(baseHidden.length, 4, "Base should have 4 hidden neurons");

    // Create 3 remove-low-impact candidates, each removing a different neuron
    // Candidate 1: Remove hidden-B
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.id !== ID_HIDDEN_B,
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_B && s.toId !== ID_HIDDEN_B,
    );
    // Reconnect: input-1 now goes directly to hidden-D
    removeBJson.synapses.push({
      fromId: 1,
      toId: ID_HIDDEN_D,
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
      (n) => n.id !== ID_HIDDEN_C,
    );
    removeCJson.synapses = removeCJson.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_C && s.toId !== ID_HIDDEN_C,
    );
    // Reconnect: hidden-A now goes directly to output
    removeCJson.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
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
      (n) => n.id !== ID_HIDDEN_D,
    );
    removeDJson.synapses = removeDJson.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_D && s.toId !== ID_HIDDEN_D,
    );
    // Reconnect: hidden-B now goes directly to output
    removeDJson.synapses.push({
      fromId: ID_HIDDEN_B,
      toId: -1,
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

    const comboJSON = combo.creature.exportInternalJSON();
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const neuronIds = hiddenNeurons.map((n) => n.id);

    // All three neurons (B, C, D) should be removed
    assertEquals(
      neuronIds.includes(ID_HIDDEN_B),
      false,
      `Removed neuron hidden-B should not exist. Found neurons: ${
        neuronIds.join(", ")
      }`,
    );
    assertEquals(
      neuronIds.includes(ID_HIDDEN_C),
      false,
      `Removed neuron hidden-C should not exist. Found neurons: ${
        neuronIds.join(", ")
      }`,
    );
    assertEquals(
      neuronIds.includes(ID_HIDDEN_D),
      false,
      `Removed neuron hidden-D should not exist. Found neurons: ${
        neuronIds.join(", ")
      }`,
    );

    // Only hidden-A should remain
    assertEquals(
      neuronIds.includes(ID_HIDDEN_A),
      true,
      "Original neuron hidden-A should exist",
    );

    // Final expected structure: only A remains (B, C, D removed)
    assertEquals(
      hiddenNeurons.length,
      1,
      `Should have 1 hidden neuron (only A). Found: ${neuronIds.join(", ")}`,
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
    const baseJSON = base.exportInternalJSON();

    // Create add-synapses candidate
    const addSynapseJson = structuredClone(baseJSON);
    addSynapseJson.synapses.push({
      fromId: 0,
      toId: ID_HIDDEN_B,
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
    const hiddenA = changeSquashJson.neurons.find((n) => n.id === ID_HIDDEN_A);
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
    const baseJSON = base.exportInternalJSON();

    // Create multiple candidates of different types
    const candidates: DiscoveryCandidate[] = [];

    // Remove candidate 1
    const remove1Json = structuredClone(baseJSON);
    remove1Json.neurons = remove1Json.neurons.filter(
      (n) => n.id !== ID_HIDDEN_B,
    );
    remove1Json.synapses = remove1Json.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_B && s.toId !== ID_HIDDEN_B,
    );
    remove1Json.synapses.push({
      fromId: 1,
      toId: ID_HIDDEN_D,
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
    remove2Json.neurons = remove2Json.neurons.filter(
      (n) => n.id !== ID_HIDDEN_C,
    );
    remove2Json.synapses = remove2Json.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_C && s.toId !== ID_HIDDEN_C,
    );
    remove2Json.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
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
      fromId: 0,
      toId: ID_HIDDEN_B,
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
    // (e.g., input-1 -> hidden-D) are correctly preserved when combining removal candidates.
    // Bug: remainingNeurons set was missing input neurons, causing these synapses to be dropped.

    const base = makeRemovalTestCreature();
    const baseJSON = base.exportInternalJSON();

    // Verify base structure contains input-1 -> hidden-B synapse (fromId=1, toId=ID_HIDDEN_B)
    const baseSynapses = baseJSON.synapses.map((s) => `${s.fromId}->${s.toId}`);
    assert(
      baseSynapses.includes(`1->${ID_HIDDEN_B}`),
      "Base should have input-1->hidden-B synapse",
    );

    // Create removal candidate that removes hidden-B
    // The reconnection synapse goes FROM input-1 (an input neuron) TO hidden-D
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.id !== ID_HIDDEN_B,
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_B && s.toId !== ID_HIDDEN_B,
    );
    // Critical reconnection synapse: input-1 -> hidden-D (bypasses removed hidden-B)
    removeBJson.synapses.push({
      fromId: 1,
      toId: ID_HIDDEN_D,
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
      (n) => n.id !== ID_HIDDEN_C,
    );
    removeCJson.synapses = removeCJson.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_C && s.toId !== ID_HIDDEN_C,
    );
    removeCJson.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
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

    const comboJSON = combo.creature.exportInternalJSON();
    const comboSynapses = comboJSON.synapses.map((s) =>
      `${s.fromId}->${s.toId}`
    );

    // The critical assertion: reconnection synapse from input-1 -> hidden-D should exist
    assert(
      comboSynapses.includes(`1->${ID_HIDDEN_D}`),
      `Reconnection synapse from input neuron (input-1->hidden-D) should be preserved. ` +
        `Found synapses: ${comboSynapses.join(", ")}`,
    );

    // Also verify hidden-A->output-0 reconnection is preserved
    assert(
      comboSynapses.includes(`${ID_HIDDEN_A}->-1`),
      `Reconnection synapse (hidden-A->output-0) should be preserved. ` +
        `Found synapses: ${comboSynapses.join(", ")}`,
    );

    // Verify both neurons were removed
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const hiddenIds = hiddenNeurons.map((n) => n.id);
    assertEquals(
      hiddenIds.includes(ID_HIDDEN_B),
      false,
      "hidden-B should be removed",
    );
    assertEquals(
      hiddenIds.includes(ID_HIDDEN_C),
      false,
      "hidden-C should be removed",
    );
  },
);
