/**
 * Test suite verifying that getTopologyHash produces consistent, correct
 * results across different creature configurations.
 *
 * Issue #2257: Original test verified export-based vs direct-compute equivalence.
 * Issue #2258: Updated to verify the string-key-based algorithm with
 * incremental neuron caching. The algorithm now uses delimiter-separated
 * strings instead of JSON.stringify for reduced allocation overhead.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("topology hash is deterministic for same creature", () => {
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

  creature.topologyHash = undefined;
  const hash1 = CreatureUtil.getTopologyHash(creature);
  creature.topologyHash = undefined;
  const hash2 = CreatureUtil.getTopologyHash(creature);

  assertEquals(
    hash1,
    hash2,
    "Same creature must produce identical topology hash on repeated calls",
  );
});

Deno.test("topology hash matches between fromJSON copies with same topology", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "hidden", uuid: "hidden-c", squash: "RELU", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.3 },
      { fromUUID: "hidden-a", toUUID: "hidden-c", weight: 0.4 },
      { fromUUID: "hidden-b", toUUID: "hidden-c", weight: 0.5 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 0.6 },
    ],
    input: 3,
    output: 1,
  };

  const creature1 = Creature.fromJSON(json);
  const creature2 = Creature.fromJSON(json);

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  assertEquals(
    hash1,
    hash2,
    "Two creatures from same JSON must have identical topology hash",
  );
});

Deno.test("topology hash differs for different weights but same topology", () => {
  const json1: CreatureExport = {
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
  };

  const json2: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 999 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: -5 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -999 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 42 },
    ],
    input: 2,
    output: 1,
  };

  const creature1 = Creature.fromJSON(json1);
  const creature2 = Creature.fromJSON(json2);

  assertEquals(
    CreatureUtil.getTopologyHash(creature1),
    CreatureUtil.getTopologyHash(creature2),
    "Same topology with different weights must produce same hash",
  );
});

Deno.test("topology hash handles constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", uuid: "const-0", bias: 1.0 },
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "const-0", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creature.topologyHash = undefined;
  const hash1 = CreatureUtil.getTopologyHash(creature);
  creature.topologyHash = undefined;
  const hash2 = CreatureUtil.getTopologyHash(creature);

  assertEquals(hash1, hash2, "Constant neuron topology hash must be stable");
});

Deno.test("topology hash is stable for large constructed creature", () => {
  const creature = new Creature(20, 10, {
    layers: [{ count: 50 }, { count: 30 }],
  });

  creature.topologyHash = undefined;
  const hash1 = CreatureUtil.getTopologyHash(creature);
  creature.topologyHash = undefined;
  const hash2 = CreatureUtil.getTopologyHash(creature);

  assertEquals(
    hash1,
    hash2,
    "Large constructed creature hash must be deterministic",
  );
});

Deno.test("topology hash handles multiple outputs", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "BIPOLAR_SIGMOID", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: 0.4 },
      { fromUUID: "hidden-0", toUUID: "output-2", weight: 0.5 },
    ],
    input: 3,
    output: 3,
  };
  const creature = Creature.fromJSON(json);

  creature.topologyHash = undefined;
  const hash1 = CreatureUtil.getTopologyHash(creature);
  creature.topologyHash = undefined;
  const hash2 = CreatureUtil.getTopologyHash(creature);

  assertEquals(
    hash1,
    hash2,
    "Multiple-output creature hash must be deterministic",
  );
});

Deno.test("different topology produces different hash", () => {
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

  assertNotEquals(
    CreatureUtil.getTopologyHash(creature1),
    CreatureUtil.getTopologyHash(creature2),
    "Different squash function must produce different hash",
  );
});

Deno.test("incremental hash after connection-only change is consistent", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.2 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.4 },
    ],
    input: 2,
    output: 1,
  });

  // Full computation (no cache).
  creature.topologyHash = undefined;
  creature._cachedNeuronTopologyKey = undefined;
  creature._cachedUuidLookup = undefined;
  const fullHash = CreatureUtil.getTopologyHash(creature);

  // Simulate connection-only invalidation: clear topologyHash but keep neuron caches.
  creature.topologyHash = undefined;
  const incrementalHash = CreatureUtil.getTopologyHash(creature);

  assertEquals(
    fullHash,
    incrementalHash,
    "Incremental hash (cached neuron data) must match full recompute",
  );
});
