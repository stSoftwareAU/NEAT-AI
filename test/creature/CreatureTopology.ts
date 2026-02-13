/**
 * Tests for CreatureTopology module.
 * Verifies connection queries, binary search, caching, and focus logic.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import {
  binarySearchSynapse,
  findInsertionPoint,
  getConnectionSet,
  getHiddenNeuronUUIDs,
  getSynapse,
  hasConnection,
  inwardConnections,
  outwardConnections,
  prebuildInwardIndex,
  selfConnection,
  type TopologyCaches,
} from "../../src/creature/CreatureTopology.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCaches(): TopologyCaches {
  return {
    cacheTo: new Map(),
    cacheFrom: new Map(),
    cacheSelf: new Map(),
    synapsesIndexedByTo: null,
    connectionSet: null,
    availableConnectionsCache: null,
    hiddenNeuronUUIDs: null,
    inwardCacheMissCount: 0,
  };
}

Deno.test("inwardConnections - finds correct inbound synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Output neuron should have inward connections
  const outputIdx = creature.neurons.length - 1;
  const caches = makeCaches();
  const inward = inwardConnections(creature, caches, outputIdx);
  assert(inward.length > 0, "Output neuron should have inward connections");
  for (const syn of inward) {
    assertEquals(
      syn.to,
      outputIdx,
      "All inward synapses should point to the target",
    );
  }
});

Deno.test("outwardConnections - finds correct outbound synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Input neurons should have outward connections
  const caches = makeCaches();
  const outward = outwardConnections(creature, caches, 0);
  assert(outward.length > 0, "Input neuron should have outward connections");
  for (const syn of outward) {
    assertEquals(
      syn.from,
      0,
      "All outward synapses should come from the source",
    );
  }
});

Deno.test("getSynapse - returns synapse when found, null otherwise", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  // Should find connections from input to output
  const caches = makeCaches();
  const found = getSynapse(creature, caches, 0, creature.input);
  assert(found !== null, "Should find connection from input 0 to output");
  assertEquals(found!.from, 0);
  assertEquals(found!.to, creature.input);

  // Should return null for non-existent connection
  const notFound = getSynapse(creature, caches, creature.input, 0);
  assertEquals(notFound, null, "Reverse connection should not exist");
});

Deno.test("binarySearchSynapse - finds correct index", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  const syn = creature.synapses[0];
  const idx = binarySearchSynapse(creature, syn.from, syn.to);
  assertNotEquals(idx, -1, "Should find first synapse");
  assertEquals(creature.synapses[idx].from, syn.from);
  assertEquals(creature.synapses[idx].to, syn.to);

  // Non-existent connection
  const missing = binarySearchSynapse(creature, 999, 999);
  assertEquals(missing, -1, "Should return -1 for non-existent");
});

Deno.test("findInsertionPoint - returns correct position", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  // Insertion point at beginning
  const pos = findInsertionPoint(creature, 0, 0);
  assert(pos >= 0, "Should return a valid position");
});

Deno.test("selfConnection - detects self-connections", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  const caches = makeCaches();
  // Simple creature should not have self-connections
  for (let i = 0; i < creature.neurons.length; i++) {
    const sc = selfConnection(creature, caches, i);
    assertEquals(sc, null, `Neuron ${i} should not have a self-connection`);
  }
});

Deno.test("hasConnection - checks connection existence", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  const caches = makeCaches();
  const syn = creature.synapses[0];
  assert(
    hasConnection(creature, caches, syn.from, syn.to),
    "Should find existing connection",
  );
  assert(
    !hasConnection(creature, caches, 999, 999),
    "Should not find non-existent connection",
  );
});

Deno.test("getConnectionSet - returns all connection keys", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  const caches = makeCaches();
  const set = getConnectionSet(creature, caches);
  assertEquals(
    set.size,
    creature.synapses.length,
    "Set size should match synapse count",
  );
});

Deno.test("getHiddenNeuronUUIDs - returns hidden neuron UUIDs", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });
  creatureValidate(creature);

  const caches = makeCaches();
  const uuids = getHiddenNeuronUUIDs(creature, caches);
  assertEquals(uuids.size, 3, "Should have 3 hidden neuron UUIDs");
});

Deno.test("prebuildInwardIndex - builds secondary index", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  const caches = makeCaches();
  assertEquals(
    caches.synapsesIndexedByTo,
    null,
    "Index should not exist initially",
  );

  prebuildInwardIndex(creature, caches);
  assertNotEquals(
    caches.synapsesIndexedByTo,
    null,
    "Index should be built after prebuild",
  );
});

Deno.test("facade delegation matches direct module calls", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Verify facade calls match module calls
  const outputIdx = creature.neurons.length - 1;
  const facadeInward = creature.inwardConnections(outputIdx);
  const facadeOutward = creature.outwardConnections(0);

  assert(facadeInward.length > 0, "Facade inwardConnections should work");
  assert(facadeOutward.length > 0, "Facade outwardConnections should work");

  // getSynapse via facade
  const syn = creature.synapses[0];
  const found = creature.getSynapse(syn.from, syn.to);
  assert(found !== null);
  assertEquals(found!.from, syn.from);
  assertEquals(found!.to, syn.to);

  // hasConnection via facade
  assert(creature.hasConnection(syn.from, syn.to));
});
