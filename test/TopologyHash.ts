/**
 * Test suite for topology hashing functionality (Issue #1016).
 *
 * Topology hashing provides a way to identify creatures with identical network
 * structure (neurons and connections) regardless of their weights and biases.
 * This enables:
 * - Efficient evaluation deduplication
 * - Structure-based species grouping
 * - Discovery result caching
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("getTopologyHash - basic hash generation", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const topologyHash = CreatureUtil.getTopologyHash(creature);
  assert(topologyHash, "Topology hash should be generated");
  assert(typeof topologyHash === "string", "Topology hash should be a string");
  assert(topologyHash.length > 0, "Topology hash should not be empty");
});

Deno.test("getTopologyHash - same topology different weights should produce same hash", () => {
  const baseCreature: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };

  const creature1 = Creature.fromJSON(baseCreature);

  // Create creature with same topology but different weights and biases
  const modifiedCreature: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.9 }, // Different bias
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: -0.5 }, // Different bias
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 }, // Different weight
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.7 }, // Different weight
      { fromUUID: "hidden-0", toUUID: "output-0", weight: -0.2 }, // Different weight
    ],
    input: 2,
    output: 1,
  };

  const creature2 = Creature.fromJSON(modifiedCreature);

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  assertEquals(
    hash1,
    hash2,
    "Creatures with same topology but different weights should have same topology hash",
  );

  // But their full UUIDs should be different (because weights differ)
  const uuid1 = CreatureUtil.makeUUID(creature1);
  const uuid2 = CreatureUtil.makeUUID(creature2);
  assertNotEquals(
    uuid1,
    uuid2,
    "Full UUIDs should differ when weights are different",
  );
});

Deno.test("getTopologyHash - different topology should produce different hash", () => {
  const creature1 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  // Different squash function
  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.5 }, // Different squash
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  assertNotEquals(
    hash1,
    hash2,
    "Creatures with different squash functions should have different topology hashes",
  );
});

Deno.test("getTopologyHash - different connection pattern should produce different hash", () => {
  const creature1 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  // Different connection pattern (additional synapse)
  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 }, // Extra connection
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  assertNotEquals(
    hash1,
    hash2,
    "Creatures with different connection patterns should have different topology hashes",
  );
});

Deno.test("getTopologyHash - order independent", () => {
  // Neurons and synapses in different order but same topology
  const creature1: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.2 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.4 },
    ],
    input: 2,
    output: 1,
  };

  // Same structure, different ordering
  const creature2: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.1 },
    ],
    input: 2,
    output: 1,
  };

  const c1 = Creature.fromJSON(creature1);
  const c2 = Creature.fromJSON(creature2);

  const hash1 = CreatureUtil.getTopologyHash(c1);
  const hash2 = CreatureUtil.getTopologyHash(c2);

  assertEquals(
    hash1,
    hash2,
    "Topology hash should be order-independent",
  );
});

Deno.test("getTopologyHash - caching works correctly", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  // First call generates hash
  const hash1 = CreatureUtil.getTopologyHash(creature);

  // Second call should return cached value
  const hash2 = CreatureUtil.getTopologyHash(creature);

  assertEquals(hash1, hash2, "Cached topology hash should match");
});

Deno.test("getTopologyHash - invalidated when structure changes", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const hash1 = CreatureUtil.getTopologyHash(creature);

  // Modifying weight should NOT change topology hash
  creature.synapses[0].weight = 999;
  delete creature.topologyHash; // Clear cache manually for this test

  const hash2 = CreatureUtil.getTopologyHash(creature);
  assertEquals(hash1, hash2, "Weight change should not affect topology hash");
});

Deno.test("getTopologyHash - different squash functions should produce different hash", () => {
  const creature1 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  // Creature with different squash function on hidden neuron
  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  assertNotEquals(
    hash1,
    hash2,
    "Creatures with different squash functions should have different topology hashes",
  );
});
