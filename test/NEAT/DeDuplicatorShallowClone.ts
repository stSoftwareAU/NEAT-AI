/**
 * Issue #2308 — Tests for DeDuplicator shallowClone optimisation.
 *
 * Validates that replacing Creature.fromJSON(creature.exportJSON()) with
 * creature.shallowClone() in the DeDuplicator retry loop produces correct
 * behaviour: mutated clones get fresh UUIDs and maintain creature integrity.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

Deno.test(
  "shallowClone + mutate produces independent creature with new UUID",
  () => {
    const original = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    const originalUuid = CreatureUtil.makeUUID(original);

    // Clone and verify independence
    const clone = original.shallowClone();
    assertEquals(clone.uuid, originalUuid, "Clone starts with parent UUID");

    // After mutation clears uuid, new UUID should be different
    // (simulating what DeDuplicator does)
    clone.synapses[0].weight += 0.1;
    delete clone.uuid;
    const cloneUuid = CreatureUtil.makeUUID(clone);

    assertNotEquals(
      cloneUuid,
      originalUuid,
      "Mutated clone should have a different UUID",
    );

    // Original should be unchanged
    assertEquals(
      original.uuid,
      originalUuid,
      "Original creature UUID should be unchanged",
    );
  },
);

Deno.test(
  "shallowClone preserves neuron UUIDs for breeding compatibility",
  () => {
    const creature = new Creature(3, 1, {
      layers: [{ count: 3, squash: "LOGISTIC" }],
    });

    // Record original neuron UUIDs
    const originalNeuronUuids = creature.neurons
      .filter((n) => n.type !== "input")
      .map((n) => n.uuid);

    const clone = creature.shallowClone();

    // Verify neuron UUIDs are preserved
    const cloneNeuronUuids = clone.neurons
      .filter((n) => n.type !== "input")
      .map((n) => n.uuid);

    assertEquals(
      cloneNeuronUuids,
      originalNeuronUuids,
      "shallowClone should preserve neuron UUIDs",
    );
  },
);

Deno.test(
  "shallowClone creates structurally independent copy",
  () => {
    const creature = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    const originalWeight = creature.synapses[0].weight;

    const clone = creature.shallowClone();
    clone.synapses[0].weight = 999;

    // Original should be unaffected
    assertEquals(
      creature.synapses[0].weight,
      originalWeight,
      "Modifying clone should not affect original",
    );
  },
);
