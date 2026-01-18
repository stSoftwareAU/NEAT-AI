import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Test suite for binary search optimisation in disconnect() method.
 * Issue #1101: Performance: Avoid disconnect() linear search using binary search.
 *
 * The synapses array is sorted by (from, to), allowing O(log n) binary search
 * instead of O(n) linear search.
 */

function createCreatureWithManySynapses(synapseCount: number): Creature {
  // Create a creature with many connections for testing
  // We'll use a layered structure to get predictable synapse ordering
  const inputCount = 10;
  const hiddenCount = Math.ceil(Math.sqrt(synapseCount / inputCount));
  const creature = new Creature(inputCount, 1, {
    layers: [{ count: hiddenCount, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function createSimpleCreature(): Creature {
  return new Creature(3, 1, {
    layers: [{ count: 2, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
}

Deno.test("disconnect: removes synapse correctly using binary search", () => {
  const creature = createSimpleCreature();
  const initialCount = creature.synapses.length;

  // Get a synapse to remove
  const synapseToRemove = creature.synapses[Math.floor(initialCount / 2)];
  const from = synapseToRemove.from;
  const to = synapseToRemove.to;

  // Verify synapse exists
  assertNotEquals(
    creature.getSynapse(from, to),
    null,
    "Synapse should exist before disconnect",
  );

  // Disconnect
  creature.disconnect(from, to);

  // Verify synapse was removed
  assertEquals(
    creature.synapses.length,
    initialCount - 1,
    "Synapse count should decrease by 1",
  );
  assertEquals(
    creature.getSynapse(from, to),
    null,
    "Synapse should not exist after disconnect",
  );
});

Deno.test("disconnect: handles non-existent synapse gracefully", () => {
  const creature = createSimpleCreature();
  const initialCount = creature.synapses.length;

  // Try to disconnect a non-existent synapse
  creature.disconnect(999, 999);

  // Count should remain unchanged
  assertEquals(
    creature.synapses.length,
    initialCount,
    "Synapse count should remain unchanged",
  );
});

Deno.test("disconnect: removes first synapse correctly", () => {
  const creature = createSimpleCreature();
  const initialCount = creature.synapses.length;

  // Get the first synapse
  const firstSynapse = creature.synapses[0];
  const from = firstSynapse.from;
  const to = firstSynapse.to;

  // Disconnect
  creature.disconnect(from, to);

  // Verify synapse was removed
  assertEquals(
    creature.synapses.length,
    initialCount - 1,
    "Synapse count should decrease by 1",
  );
  assertEquals(
    creature.getSynapse(from, to),
    null,
    "First synapse should not exist after disconnect",
  );
});

Deno.test("disconnect: removes last synapse correctly", () => {
  const creature = createSimpleCreature();
  const initialCount = creature.synapses.length;

  // Get the last synapse
  const lastSynapse = creature.synapses[creature.synapses.length - 1];
  const from = lastSynapse.from;
  const to = lastSynapse.to;

  // Disconnect
  creature.disconnect(from, to);

  // Verify synapse was removed
  assertEquals(
    creature.synapses.length,
    initialCount - 1,
    "Synapse count should decrease by 1",
  );
  assertEquals(
    creature.getSynapse(from, to),
    null,
    "Last synapse should not exist after disconnect",
  );
});

Deno.test("disconnect: maintains sorted order after removal", () => {
  const creature = createSimpleCreature();

  // Get a synapse from the middle
  const midIndex = Math.floor(creature.synapses.length / 2);
  const midSynapse = creature.synapses[midIndex];

  // Disconnect
  creature.disconnect(midSynapse.from, midSynapse.to);

  // Verify synapses remain sorted by (from, to)
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];

    const isSorted = prev.from < curr.from ||
      (prev.from === curr.from && prev.to < curr.to);

    assertEquals(isSorted, true, `Synapses should remain sorted at index ${i}`);
  }
});

Deno.test("disconnect: invalidates caches correctly", () => {
  const creature = createSimpleCreature();

  // Build caches by calling methods that populate them
  creature.inwardConnections(creature.neurons.length - 1);
  creature.getConnectionSet();

  // Get a synapse to remove
  const synapse = creature.synapses[0];

  // Disconnect
  creature.disconnect(synapse.from, synapse.to);

  // Verify caches were invalidated (cachedScoreComponents should be undefined)
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be invalidated after disconnect",
  );

  // The connection set should not contain the removed synapse
  assertEquals(
    creature.hasConnection(synapse.from, synapse.to),
    false,
    "Connection set should not contain removed synapse",
  );
});

Deno.test("disconnect: works with many synapses same from index", () => {
  // Create a creature where multiple synapses have the same 'from' index
  const creature = new Creature(5, 2, {
    layers: [{ count: 3, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });

  // Find synapses with the same 'from' value
  const from0Synapses = creature.synapses.filter((s) => s.from === 0);

  // Remove one of them
  if (from0Synapses.length > 0) {
    const toRemove = from0Synapses[0];
    const initialCount = creature.synapses.length;

    creature.disconnect(toRemove.from, toRemove.to);

    assertEquals(
      creature.synapses.length,
      initialCount - 1,
      "Synapse count should decrease",
    );
    assertEquals(
      creature.getSynapse(toRemove.from, toRemove.to),
      null,
      "Removed synapse should not exist",
    );
  }
});

Deno.test("disconnect: handles single synapse creature", () => {
  // Create a minimal creature with just input -> output connections
  const creature = new Creature(1, 1, {
    outputLayer: { squash: IDENTITY.NAME },
  });

  // Should have exactly 1 synapse (input-0 -> output-0)
  assertEquals(creature.synapses.length, 1, "Should have exactly 1 synapse");

  const synapse = creature.synapses[0];
  creature.disconnect(synapse.from, synapse.to);

  assertEquals(
    creature.synapses.length,
    0,
    "Should have no synapses after disconnect",
  );
});

Deno.test("disconnect: sequential disconnects work correctly", () => {
  const creature = createSimpleCreature();

  // Disconnect multiple synapses sequentially
  const synapsesToRemove = creature.synapses.slice(0, 3).map((s) => ({
    from: s.from,
    to: s.to,
  }));

  for (const { from, to } of synapsesToRemove) {
    creature.disconnect(from, to);
    assertEquals(
      creature.getSynapse(from, to),
      null,
      `Synapse ${from}->${to} should be removed`,
    );
  }

  // Verify all were removed
  for (const { from, to } of synapsesToRemove) {
    assertEquals(
      creature.getSynapse(from, to),
      null,
      `Synapse ${from}->${to} should remain removed`,
    );
  }
});

Deno.test("disconnect: binarySearchSynapse finds correct index", () => {
  const creature = createCreatureWithManySynapses(100);

  // Test that disconnect works for various positions in the sorted array
  const testPositions = [
    0,
    creature.synapses.length - 1,
    Math.floor(creature.synapses.length / 2),
  ];

  for (const pos of testPositions) {
    // Create a fresh creature for each test
    const testCreature = createCreatureWithManySynapses(100);
    const synapse = testCreature.synapses[pos];
    const initialCount = testCreature.synapses.length;

    testCreature.disconnect(synapse.from, synapse.to);

    assertEquals(
      testCreature.synapses.length,
      initialCount - 1,
      `Position ${pos}: synapse count should decrease`,
    );
    assertEquals(
      testCreature.getSynapse(synapse.from, synapse.to),
      null,
      `Position ${pos}: synapse should be removed`,
    );
  }
});

Deno.test("disconnect: empty synapses array handled gracefully", () => {
  const creature = new Creature(1, 1, { lazyInitialization: true });
  creature.neurons = [];
  creature.synapses = [];

  // Should not throw
  creature.disconnect(0, 1);

  assertEquals(creature.synapses.length, 0, "Synapses should remain empty");
});
