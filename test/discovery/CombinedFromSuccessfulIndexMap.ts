/**
 * Tests for CombinedFromSuccessful index mapping correctness.
 *
 * Verifies that combination key generation (used to de-duplicate combinations)
 * produces correct results after refactoring indexOf() to Map-based lookups.
 * This ensures removal and non-removal index mapping is correct.
 */

import { assert, assertExists } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

/** Creates a test creature with hidden neurons for combination testing. */
function makeBaseCreature() {
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
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "hidden-C", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: mixed removal and non-removal candidates produce correct combinations",
  () => {
    const base = makeBaseCreature();
    const baseJSON = base.exportJSON();

    // Removal candidate: remove hidden-B
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.id !== 8002,
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromId !== 8002 && s.toId !== 8002,
    );
    removeBJson.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-C",
      weight: 0.5,
    });
    const removeBCreature = Creature.fromJSON(removeBJson);
    delete removeBCreature.uuid;
    removeBCreature.fix();
    CreatureUtil.makeUUID(removeBCreature);

    // Add synapse candidate
    const addJson = structuredClone(baseJSON);
    addJson.synapses.push({
      fromUUID: "input-0",
      toUUID: "hidden-B",
      weight: 0.2,
    });
    const addCreature = Creature.fromJSON(addJson);
    delete addCreature.uuid;
    addCreature.fix();
    CreatureUtil.makeUUID(addCreature);

    // Change squash candidate
    const squashJson = structuredClone(baseJSON);
    const hiddenA = squashJson.neurons.find((n) => n.id === 8001);
    if (hiddenA) hiddenA.squash = "TANH";
    const squashCreature = Creature.fromJSON(squashJson);
    delete squashCreature.uuid;
    squashCreature.fix();
    CreatureUtil.makeUUID(squashCreature);

    const candidates: DiscoveryCandidate[] = [
      {
        creature: removeBCreature,
        change: {
          type: "remove-low-impact",
          description: "Removed neuron hidden-B",
        },
      },
      {
        creature: addCreature,
        change: {
          type: "add-synapses",
          description: "Added synapse input-0 -> hidden-B",
        },
      },
      {
        creature: squashCreature,
        change: {
          type: "change-squash",
          description: "Changed activation for hidden-A",
        },
      },
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_INDEX_MAP",
      candidates,
    );

    // Should have the all-combined candidate (strategy 1)
    assert(combined.length > 0, "Should produce combined candidates");

    // Verify we get pairwise combinations (strategy 4)
    // With 3 candidates, we should get C(3,2) = 3 pairs (minus any already seen)
    const comboTypes = combined.map((c) => c.change.type);
    const comboCount =
      comboTypes.filter((t) => t === "combo-successful").length;
    assert(
      comboCount >= 1,
      `Should have at least one combo-successful candidate, got ${comboCount}`,
    );

    // Non-removal candidates (add-synapses, change-squash) should produce
    // a non-removal combination (strategy 3)
    // Just verify the total count is reasonable
    assert(
      combined.length >= 3,
      `Should have at least 3 combinations (all, non-removal, pairwise). Got: ${combined.length}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: appliedTypes tracks unique types correctly",
  () => {
    const base = makeBaseCreature();
    const baseJSON = base.exportJSON();

    // Create two removal candidates of the same type
    const removeBJson = structuredClone(baseJSON);
    removeBJson.neurons = removeBJson.neurons.filter(
      (n) => n.id !== 8002,
    );
    removeBJson.synapses = removeBJson.synapses.filter(
      (s) => s.fromId !== 8002 && s.toId !== 8002,
    );
    removeBJson.synapses.push({
      fromUUID: "input-1",
      toUUID: "hidden-C",
      weight: 0.5,
    });
    const removeBCreature = Creature.fromJSON(removeBJson);
    delete removeBCreature.uuid;
    removeBCreature.fix();
    CreatureUtil.makeUUID(removeBCreature);

    const removeCJson = structuredClone(baseJSON);
    removeCJson.neurons = removeCJson.neurons.filter(
      (n) => n.id !== 8003,
    );
    removeCJson.synapses = removeCJson.synapses.filter(
      (s) => s.fromId !== 8003 && s.toId !== 8003,
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

    const candidates: DiscoveryCandidate[] = [
      {
        creature: removeBCreature,
        change: {
          type: "remove-low-impact",
          description: "Removed neuron hidden-B",
        },
      },
      {
        creature: removeCCreature,
        change: {
          type: "remove-low-impact",
          description: "Removed neuron hidden-C",
        },
      },
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_APPLIED_TYPES",
      candidates,
    );

    assert(combined.length > 0, "Should produce combined candidates");

    // The all-combined candidate should exist
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    // Since both candidates are remove-low-impact (same type),
    // the description should reflect a removal-only combination
    const desc = combo.change.description ?? "";
    assert(
      desc.includes("Pruned") || desc.includes("Removed"),
      `Same-type removals should produce removal-only description: "${desc}"`,
    );
  },
);
