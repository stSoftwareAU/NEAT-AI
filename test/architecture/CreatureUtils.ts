/**
 * Unit tests for CreatureUtils.
 *
 * Issue #1407: Targeted unit tests for architecture core - creature utility
 * functions including UUID generation, topology hashing, and array shuffling.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";

// --- CreatureUtil.makeUUID tests ---

Deno.test("CreatureUtil.makeUUID - generates a UUID for a creature", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  delete creature.uuid;
  const uuid = CreatureUtil.makeUUID(creature);

  assert(uuid !== undefined, "UUID should be generated");
  assert(uuid.length > 0, "UUID should be non-empty");
  // UUID v5 format: 8-4-4-4-12 hex digits
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid),
    `UUID should be valid format, got: ${uuid}`,
  );
});

Deno.test("CreatureUtil.makeUUID - returns existing UUID if set", () => {
  const creature = new Creature(2, 1);
  creature.uuid = "pre-existing-uuid";

  const uuid = CreatureUtil.makeUUID(creature);
  assertEquals(uuid, "pre-existing-uuid");
});

Deno.test("CreatureUtil.makeUUID - deterministic for same structure", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-a",
        bias: 0.5,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.1,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.3 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const creature1 = Creature.fromJSON(json);
  delete creature1.uuid;
  const uuid1 = CreatureUtil.makeUUID(creature1);

  const creature2 = Creature.fromJSON(json);
  delete creature2.uuid;
  const uuid2 = CreatureUtil.makeUUID(creature2);

  assertEquals(uuid1, uuid2, "Same structure should produce same UUID");
});

Deno.test("CreatureUtil.makeUUID - different weights produce different UUIDs", () => {
  // Use identical topology with different weights via JSON to ensure
  // only the weight difference affects the UUID
  const json1 = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden" as const, uuid: "h1", bias: 0.0, squash: "IDENTITY" },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const json2 = { ...json1, synapses: [...json1.synapses] };
  json2.synapses[0] = { ...json1.synapses[0], weight: 0.9 };

  const c1 = Creature.fromJSON(json1);
  delete c1.uuid;
  const c2 = Creature.fromJSON(json2);
  delete c2.uuid;

  const u1 = CreatureUtil.makeUUID(c1);
  const u2 = CreatureUtil.makeUUID(c2);

  assert(u1 !== u2, "Different weights should produce different UUIDs");
});

Deno.test("CreatureUtil.makeUUID - tags do not affect UUID", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden" as const, uuid: "h1", bias: 0.5, squash: "IDENTITY" },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.1,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const creature1 = Creature.fromJSON(json);
  delete creature1.uuid;
  const uuid1 = CreatureUtil.makeUUID(creature1);

  // Add tags to the second creature
  const jsonWithTags = {
    ...json,
    neurons: json.neurons.map((n) => ({
      ...n,
      tags: [{ name: "test", value: "1" }],
    })),
  };
  const creature2 = Creature.fromJSON(jsonWithTags);
  delete creature2.uuid;
  const uuid2 = CreatureUtil.makeUUID(creature2);

  assertEquals(uuid1, uuid2, "Tags should not affect UUID");
});

Deno.test("CreatureUtil.makeUUID - stores UUID on creature", () => {
  const creature = new Creature(2, 1);
  delete creature.uuid;

  const uuid = CreatureUtil.makeUUID(creature);
  assertEquals(creature.uuid, uuid, "UUID should be stored on creature");
});

// --- CreatureUtil.getTopologyHash tests ---

Deno.test("CreatureUtil.getTopologyHash - generates a hash", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  const hash = CreatureUtil.getTopologyHash(creature);

  assert(hash !== undefined, "Topology hash should be generated");
  assert(hash.length > 0, "Hash should be non-empty");
});

Deno.test("CreatureUtil.getTopologyHash - same topology different weights produce same hash", () => {
  const json1 = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden" as const, uuid: "h1", bias: 0.5, squash: "IDENTITY" },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.1,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const json2 = {
    ...json1,
    neurons: json1.neurons.map((n) => ({ ...n, bias: n.bias + 1 })),
    synapses: json1.synapses.map((s) => ({ ...s, weight: s.weight * 2 })),
  };

  const c1 = Creature.fromJSON(json1);
  delete c1.topologyHash;
  const c2 = Creature.fromJSON(json2);
  delete c2.topologyHash;

  const hash1 = CreatureUtil.getTopologyHash(c1);
  const hash2 = CreatureUtil.getTopologyHash(c2);

  assertEquals(
    hash1,
    hash2,
    "Same topology should produce same hash regardless of weights",
  );
});

Deno.test("CreatureUtil.getTopologyHash - different topology produces different hash", () => {
  const json1 = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden" as const, uuid: "h1", bias: 0.0, squash: "IDENTITY" },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
    ],
  };

  // Different topology: add extra hidden neuron
  const json2 = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden" as const, uuid: "h1", bias: 0.0, squash: "IDENTITY" },
      { type: "hidden" as const, uuid: "h2", bias: 0.0, squash: "IDENTITY" },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.5 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const c1 = Creature.fromJSON(json1);
  delete c1.topologyHash;
  const c2 = Creature.fromJSON(json2);
  delete c2.topologyHash;

  const hash1 = CreatureUtil.getTopologyHash(c1);
  const hash2 = CreatureUtil.getTopologyHash(c2);

  assert(hash1 !== hash2, "Different topology should produce different hash");
});

Deno.test("CreatureUtil.getTopologyHash - caches the hash", () => {
  const creature = new Creature(2, 1);
  delete creature.topologyHash;

  const hash = CreatureUtil.getTopologyHash(creature);
  assertEquals(
    creature.topologyHash,
    hash,
    "Hash should be cached on creature",
  );

  // Second call returns cached value
  const hash2 = CreatureUtil.getTopologyHash(creature);
  assertEquals(hash, hash2);
});

// --- CreatureUtil.shuffle tests ---

Deno.test("CreatureUtil.shuffle - shuffles array in place", () => {
  const arr = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const original = new Int32Array(arr);

  CreatureUtil.shuffle(arr);

  // Same length
  assertEquals(arr.length, original.length);

  // Same elements (sum should be equal)
  let sumOriginal = 0;
  let sumShuffled = 0;
  for (let i = 0; i < arr.length; i++) {
    sumOriginal += original[i];
    sumShuffled += arr[i];
  }
  assertEquals(
    sumShuffled,
    sumOriginal,
    "Sum should be preserved after shuffle",
  );
});

Deno.test("CreatureUtil.shuffle - does not modify single element array", () => {
  const arr = new Int32Array([42]);
  CreatureUtil.shuffle(arr);
  assertEquals(arr[0], 42);
});

Deno.test("CreatureUtil.shuffle - does not modify empty array", () => {
  const arr = new Int32Array(0);
  CreatureUtil.shuffle(arr);
  assertEquals(arr.length, 0);
});

Deno.test("CreatureUtil.shuffle - preserves all elements (two element array)", () => {
  const arr = new Int32Array([10, 20]);
  CreatureUtil.shuffle(arr);

  // Should contain both elements
  const sorted = new Int32Array(arr).sort();
  assertEquals(sorted[0], 10);
  assertEquals(sorted[1], 20);
});
