/**
 * Tests for issue #1098: Cache available connection pairs for AddConnection mutation
 *
 * The optimisation caches available connection pairs to avoid recomputing
 * the O(n²) iteration on every AddConnection mutation call.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("AvailableConnectionsCache: getAvailableConnections returns cached results", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // First call computes and caches
  const available1 = creature.getAvailableConnections();
  assertEquals(available1.length, 3);

  // Second call should return cached result (same array reference)
  const available2 = creature.getAvailableConnections();
  assertEquals(available1, available2, "Should return same cached array");
});

Deno.test("AvailableConnectionsCache: cache invalidates after connect()", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Get initial available connections (should be cached)
  const available1 = creature.getAvailableConnections();
  assertEquals(available1.length, 3);

  // Add a connection (should invalidate cache)
  creature.connect(1, 2, 0.5); // input-1 to hidden

  // Get available connections again (should recompute)
  const available2 = creature.getAvailableConnections();

  // Should have one fewer available connection
  assertEquals(available2.length, 2);

  // Should be a different array reference
  assertEquals(
    available1 !== available2,
    true,
    "Should be different arrays after invalidation",
  );
});

Deno.test("AvailableConnectionsCache: cache invalidates after disconnect()", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Get initial available connections
  const available1 = creature.getAvailableConnections();
  assertEquals(available1.length, 2); // 0->3 and 1->3

  // Disconnect one synapse (should invalidate cache)
  creature.disconnect(1, 2); // Remove input-1 to hidden

  // Get available connections again
  const available2 = creature.getAvailableConnections();

  // Should have one more available connection now
  assertEquals(available2.length, 3);
});

Deno.test("AvailableConnectionsCache: cache invalidates after clearCache()", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  // Cache the available connections
  const available1 = creature.getAvailableConnections();

  // Clear cache
  creature.clearCache();

  // Get available connections again
  const available2 = creature.getAvailableConnections();

  // Should be different array references
  assertEquals(
    available1 !== available2,
    true,
    "Should be different arrays after clearCache()",
  );
});

Deno.test("AvailableConnectionsCache: isAvailableConnectionsCacheBuilt returns correct state", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  // Initially cache should not be built
  assertEquals(creature.isAvailableConnectionsCacheBuilt(), false);

  // After getting available connections, cache should be built
  creature.getAvailableConnections();
  assertEquals(creature.isAvailableConnectionsCacheBuilt(), true);

  // After clearing cache, it should be invalidated
  creature.clearCache();
  assertEquals(creature.isAvailableConnectionsCacheBuilt(), false);
});

Deno.test("AvailableConnectionsCache: multiple mutations with cache", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  // Add some hidden neurons first
  const addNeuron = new AddNeuron(creature);
  for (let i = 5; i--;) {
    addNeuron.mutate();
  }

  const initialSynapseCount = creature.synapses.length;
  const initialAvailable = creature.getAvailableConnections().length;

  // Perform multiple AddConnection mutations
  const addConnection = new AddConnection(creature);
  let connectionsAdded = 0;

  for (let i = 10; i--;) {
    if (addConnection.mutate()) {
      connectionsAdded++;
    }
  }

  // Verify that the right number of connections were added
  assertEquals(
    creature.synapses.length,
    initialSynapseCount + connectionsAdded,
  );

  // Verify that available connections decreased by connections added
  const finalAvailable = creature.getAvailableConnections().length;
  assertEquals(
    finalAvailable,
    initialAvailable - connectionsAdded,
  );

  // Creature should still be valid
  creatureValidate(creature);
});

Deno.test("AvailableConnectionsCache: focus list filtering works with cache", () => {
  const json = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden" as const,
        uuid: "hidden-2",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Get all available connections (should be cached)
  const allAvailable = creature.getAvailableConnections();
  assertGreater(allAvailable.length, 0);

  // Get available connections with focus list
  // Focus on neuron index 3 (hidden-1)
  const focusedAvailable = creature.getAvailableConnections([3]);

  // Focused list should be a subset of all available
  for (const [from, to] of focusedAvailable) {
    // Each pair should involve the focused neuron
    assertEquals(
      from === 3 || to === 3 || creature.inFocus(from, [3]) ||
        creature.inFocus(to, [3]),
      true,
      `Connection ${from}->${to} should involve focused neuron`,
    );
  }
});

Deno.test("AvailableConnectionsCache: cache correctly handles neuron removal", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden" as const,
        uuid: "hidden-2",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 1 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Cache available connections
  const available1 = creature.getAvailableConnections();
  assertGreater(available1.length, 0);

  // Remove the connection from hidden-1 to hidden-2, which should remove hidden-1
  // during fix() since it has no outward connections
  creature.disconnect(0, 2); // Remove input-0 to hidden-1
  creature.fix(); // This should remove hidden-1

  // Cache should be invalidated and recomputed
  const available2 = creature.getAvailableConnections();

  // Creature should still be valid
  creatureValidate(creature);

  // Available connections count will change due to structure change
  assertEquals(
    available1 !== available2,
    true,
    "Should be different arrays after structure change",
  );
});

Deno.test("AvailableConnectionsCache: cache validates with AddNeuron mutation", () => {
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  // Get initial available connections
  const available1 = creature.getAvailableConnections();

  // Add a neuron (should invalidate cache due to structure change)
  const addNeuron = new AddNeuron(creature);
  addNeuron.mutate();

  // Get available connections again
  const available2 = creature.getAvailableConnections();

  // Should be a different array (cache invalidated)
  assertEquals(
    available1 !== available2,
    true,
    "Cache should be invalidated after AddNeuron",
  );

  // Creature should still be valid
  creatureValidate(creature);
});
