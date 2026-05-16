/**
 * Issue #2308 — Tests for the optimised makeUUID() direct construction path.
 *
 * Validates that the optimised makeUUID() (which builds the hash string
 * directly from creature arrays instead of calling exportJSON()) produces
 * correct, deterministic, and unique UUIDs.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

Deno.test(
  "makeUUID direct construction — deterministic for same creature",
  () => {
    const creature = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });

    // Clear any cached UUID
    delete creature.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature);

    delete creature.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature);

    assertEquals(uuid1, uuid2, "Same creature should produce same UUID");
  },
);

Deno.test(
  "makeUUID direct construction — different weights produce different UUIDs",
  () => {
    const creature1 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    // Set specific weights
    for (const synapse of creature1.synapses) {
      synapse.weight = 0.5;
    }
    delete creature1.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature1);

    const creature2 = Creature.fromJSON(creature1.exportJSON());
    // Change a weight
    creature2.synapses[0].weight = 0.9;
    delete creature2.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature2);

    assertNotEquals(
      uuid1,
      uuid2,
      "Different weights should produce different UUIDs",
    );
  },
);

Deno.test(
  "makeUUID direct construction — different biases produce different UUIDs",
  () => {
    const creature1 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    delete creature1.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature1);

    const creature2 = Creature.fromJSON(creature1.exportJSON());
    // Change a bias on a non-input neuron
    const hiddenIdx = creature2.input;
    creature2.neurons[hiddenIdx].bias = 999;
    delete creature2.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature2);

    assertNotEquals(
      uuid1,
      uuid2,
      "Different biases should produce different UUIDs",
    );
  },
);

Deno.test(
  "makeUUID direct construction — different squash produces different UUIDs",
  () => {
    const creature1 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    delete creature1.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature1);

    const creature2 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "TANH" }],
    });
    // Align weights to isolate squash difference.
    // Use the minimum length as the two architectures may produce different synapse counts.
    const minSynapses = Math.min(
      creature1.synapses.length,
      creature2.synapses.length,
    );
    for (let i = 0; i < minSynapses; i++) {
      creature2.synapses[i].weight = creature1.synapses[i].weight;
    }
    for (let i = creature2.input; i < creature2.neurons.length; i++) {
      creature2.neurons[i].bias = creature1.neurons[i].bias;
    }
    delete creature2.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature2);

    assertNotEquals(
      uuid1,
      uuid2,
      "Different squash functions should produce different UUIDs",
    );
  },
);

Deno.test(
  "makeUUID direct construction — tags do not affect UUID",
  () => {
    const creature1 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    delete creature1.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature1);

    // Add tags to the creature (should not change UUID)
    const creature2 = creature1.shallowClone();
    creature2.tags = [{ name: "test", value: "value" }];
    delete creature2.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature2);

    assertEquals(uuid1, uuid2, "Tags should not affect creature UUID");
  },
);

Deno.test(
  "makeUUID direct construction — frozen synapse changes UUID",
  () => {
    const creature1 = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    delete creature1.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature1);

    const creature2 = creature1.shallowClone();
    creature2.synapses[0].frozen = true;
    delete creature2.uuid;
    const uuid2 = CreatureUtil.makeUUID(creature2);

    assertNotEquals(
      uuid1,
      uuid2,
      "Frozen synapse should produce a different UUID",
    );
  },
);

Deno.test(
  "makeUUID direct construction — cached UUID is returned immediately",
  () => {
    const creature = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });

    // First call computes
    delete creature.uuid;
    const uuid1 = CreatureUtil.makeUUID(creature);

    // Second call should return cached
    const uuid2 = CreatureUtil.makeUUID(creature);

    assertEquals(uuid1, uuid2, "Cached UUID should match computed UUID");
    assertEquals(creature.uuid, uuid1, "UUID should be stored on creature");
  },
);

Deno.test(
  "makeUUID direct construction — shallowClone preserves UUID",
  () => {
    const creature = new Creature(3, 1, {
      layers: [{ count: 2, squash: "LOGISTIC" }],
    });
    const uuid = CreatureUtil.makeUUID(creature);

    const clone = creature.shallowClone();
    assertEquals(clone.uuid, uuid, "shallowClone should preserve UUID");
  },
);
