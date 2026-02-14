/**
 * Tests for issue #1445: Selective cache invalidation by mutation type.
 *
 * Verifies that:
 * - connect()/disconnect() preserve hiddenNeuronUUIDs cache (no neurons change)
 * - connect()/disconnect() properly invalidate connection-related caches
 * - Full clearCache() still clears everything
 * - Score cache is properly invalidated by all operations that affect it
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { calculate } from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function createTestCreature(): Creature {
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
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.5 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 1 },
    ],
  };
  return Creature.fromJSON(json, true);
}

// ── hiddenNeuronUUIDs preservation tests ──

Deno.test("SelectiveCacheInvalidation: connect() preserves hiddenNeuronUUIDs cache", () => {
  const creature = createTestCreature();

  // Build the hiddenNeuronUUIDs cache
  const uuids1 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids1.size, 2, "Should have 2 hidden neuron UUIDs");

  // Add a connection (doesn't change neuron set)
  creature.connect(0, 4, 0.5); // input-0 to output-0

  // hiddenNeuronUUIDs should still be cached (same object reference)
  const uuids2 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids2.size, 2, "Should still have 2 hidden neuron UUIDs");
  assert(
    uuids1 === uuids2,
    "Should be the same Set reference (cache preserved after connect)",
  );

  creatureValidate(creature);
});

Deno.test("SelectiveCacheInvalidation: disconnect() preserves hiddenNeuronUUIDs cache", () => {
  const creature = createTestCreature();

  // Add an extra connection so we can disconnect without breaking the creature
  creature.connect(0, 3, 0.3); // input-0 to hidden-2

  // Build the hiddenNeuronUUIDs cache
  const uuids1 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids1.size, 2, "Should have 2 hidden neuron UUIDs");

  // Remove a connection (doesn't change neuron set)
  creature.disconnect(0, 3); // Remove input-0 to hidden-2

  // hiddenNeuronUUIDs should still be cached (same object reference)
  const uuids2 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids2.size, 2, "Should still have 2 hidden neuron UUIDs");
  assert(
    uuids1 === uuids2,
    "Should be the same Set reference (cache preserved after disconnect)",
  );

  creatureValidate(creature);
});

// ── Connection-related cache invalidation tests ──

Deno.test("SelectiveCacheInvalidation: connect() invalidates connectionSet", () => {
  const creature = createTestCreature();

  // Build the connection set cache
  const connSet1 = creature.getConnectionSet();
  const size1 = connSet1.size;

  // Add a connection
  creature.connect(0, 4, 0.5);

  // Connection set should be rebuilt (different reference)
  const connSet2 = creature.getConnectionSet();
  assertEquals(connSet2.size, size1 + 1, "Connection set should grow by 1");
  assert(
    connSet1 !== connSet2,
    "Connection set should be a new Set after connect()",
  );
});

Deno.test("SelectiveCacheInvalidation: connect() invalidates availableConnectionsCache", () => {
  const creature = createTestCreature();

  // Build available connections cache
  const available1 = creature.getAvailableConnections();
  const count1 = available1.length;

  // Add a connection
  creature.connect(0, 4, 0.5);

  // Available connections should be recomputed
  const available2 = creature.getAvailableConnections();
  assertEquals(
    available2.length,
    count1 - 1,
    "Available connections should shrink by 1",
  );
  assert(
    available1 !== available2,
    "Available connections should be a new array after connect()",
  );
});

// ── Full clearCache still works ──

Deno.test("SelectiveCacheInvalidation: full clearCache() invalidates everything", () => {
  const creature = createTestCreature();

  // Build all caches
  const uuids1 = creature.getHiddenNeuronUUIDs();
  creature.getConnectionSet();
  creature.getAvailableConnections();
  creature.prebuildInwardIndex();

  // Full clear
  creature.clearCache();

  // Everything should be invalidated
  assertEquals(
    creature.isAvailableConnectionsCacheBuilt(),
    false,
    "Available connections cache should be cleared",
  );
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Inward index should be cleared",
  );

  // Rebuilding should produce different references
  const uuids2 = creature.getHiddenNeuronUUIDs();
  assert(
    uuids1 !== uuids2,
    "hiddenNeuronUUIDs should be a new Set after full clearCache()",
  );
});

// ── Score cache invalidation correctness ──

Deno.test("SelectiveCacheInvalidation: connect() invalidates score cache", () => {
  const creature = createTestCreature();

  // Force score cache to be built by calculating
  calculate(creature, 0.1, 0.0001);
  assert(
    creature.cachedScoreComponents !== undefined,
    "Score cache should exist after calculate",
  );

  // connect() should invalidate score cache
  creature.connect(0, 4, 0.5);
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be invalidated after connect()",
  );
});

Deno.test("SelectiveCacheInvalidation: disconnect() invalidates score cache", () => {
  const creature = createTestCreature();

  // Add an extra connection first
  creature.connect(0, 3, 0.3);

  // Build score cache
  calculate(creature, 0.1, 0.0001);
  assert(
    creature.cachedScoreComponents !== undefined,
    "Score cache should exist after calculate",
  );

  // disconnect() should invalidate score cache
  creature.disconnect(0, 3);
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be invalidated after disconnect()",
  );
});

// ── connectBatch / disconnectBatch preserve hiddenNeuronUUIDs ──

Deno.test("SelectiveCacheInvalidation: connectBatch() preserves hiddenNeuronUUIDs cache", () => {
  const creature = createTestCreature();

  // Build the hiddenNeuronUUIDs cache
  const uuids1 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids1.size, 2);

  // Add batch connections (doesn't change neuron set)
  creature.connectBatch([
    { from: 0, to: 4, weight: 0.5 },
    { from: 1, to: 4, weight: 0.3 },
  ]);

  // hiddenNeuronUUIDs should still be cached (same reference)
  const uuids2 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids2.size, 2);
  assert(
    uuids1 === uuids2,
    "Should be the same Set reference (cache preserved) after connectBatch",
  );

  creatureValidate(creature);
});

Deno.test("SelectiveCacheInvalidation: disconnectBatch() preserves hiddenNeuronUUIDs cache", () => {
  const creature = createTestCreature();

  // Add extra connections to disconnect
  creature.connect(0, 4, 0.5);
  creature.connect(1, 4, 0.3);

  // Build the hiddenNeuronUUIDs cache
  const uuids1 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids1.size, 2);

  // Remove batch connections
  creature.disconnectBatch([
    { from: 0, to: 4 },
    { from: 1, to: 4 },
  ]);

  // hiddenNeuronUUIDs should still be cached (same reference)
  const uuids2 = creature.getHiddenNeuronUUIDs();
  assertEquals(uuids2.size, 2);
  assert(
    uuids1 === uuids2,
    "Should be the same Set reference (cache preserved) after disconnectBatch",
  );

  creatureValidate(creature);
});

// ── Larger creature tests for correctness ──

Deno.test("SelectiveCacheInvalidation: many connect/disconnect preserve hiddenNeuronUUIDs", () => {
  const creature = new Creature(5, 2, {
    layers: [
      { count: 10, squash: IDENTITY.NAME },
      { count: 5, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  creatureValidate(creature);

  // Build and record the UUID set
  const uuids1 = creature.getHiddenNeuronUUIDs();
  const uuidCount = uuids1.size;
  assert(uuidCount > 0, "Should have hidden neurons");

  // Perform multiple connect/disconnect cycles
  const available = creature.getAvailableConnections();
  const toAdd = available.slice(0, Math.min(5, available.length));

  for (const [from, to] of toAdd) {
    creature.connect(from, to, 0.1);
    // After each connect, UUID cache should be preserved (same reference)
    const currentUUIDs = creature.getHiddenNeuronUUIDs();
    assert(
      currentUUIDs === uuids1,
      `UUID cache should be same reference after connecting ${from}->${to}`,
    );
  }

  // Disconnect some
  for (const [from, to] of toAdd) {
    creature.disconnect(from, to);
    const currentUUIDs = creature.getHiddenNeuronUUIDs();
    assert(
      currentUUIDs === uuids1,
      `UUID cache should be same reference after disconnecting ${from}->${to}`,
    );
  }

  creatureValidate(creature);
});
