import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";

/**
 * Test: Inward connections are returned sorted by `from` index.
 *
 * Issue #1536: The WASM trace path relied on .slice().sort() to get
 * inward connections in sorted order. These tests verify that
 * inwardConnections() always returns results sorted by `from`,
 * making the redundant sort unnecessary.
 */

Deno.test("inwardConnections returns results sorted by from index", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      { type: "input", squash: "LOGISTIC", index: 3 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 4, weight: 1 },
      { from: 1, to: 4, weight: 2 },
      { from: 2, to: 4, weight: 3 },
      { from: 3, to: 4, weight: 4 },
    ],
    input: 4,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const inward = creature.inwardConnections(4);
  assertEquals(inward.length, 4, "Should have 4 inward connections");

  // Verify sorted by from index
  for (let i = 1; i < inward.length; i++) {
    assertEquals(
      inward[i].from > inward[i - 1].from,
      true,
      `Connection at index ${i} (from=${inward[i].from}) should be after ` +
        `connection at index ${i - 1} (from=${inward[i - 1].from})`,
    );
  }
});

Deno.test("inwardConnections sorted order with prebuilt index", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      { type: "hidden", squash: "LOGISTIC", index: 3, bias: 0 },
      { type: "hidden", squash: "LOGISTIC", index: 4, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 5,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1 },
      { from: 1, to: 3, weight: 2 },
      { from: 2, to: 3, weight: 3 },
      { from: 0, to: 4, weight: 4 },
      { from: 2, to: 4, weight: 5 },
      { from: 3, to: 5, weight: 6 },
      { from: 4, to: 5, weight: 7 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Prebuild the index to use the binary search path
  creature.prebuildInwardIndex();

  // Verify sorted order for each non-input neuron
  for (let i = 3; i <= 5; i++) {
    const inward = creature.inwardConnections(i);
    for (let j = 1; j < inward.length; j++) {
      assertEquals(
        inward[j].from >= inward[j - 1].from,
        true,
        `Neuron ${i}: connection at index ${j} (from=${inward[j].from}) ` +
          `should be >= connection at index ${j - 1} (from=${
            inward[j - 1].from
          })`,
      );
    }
  }
});

Deno.test("inwardConnections sorted order with bulk load", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      { type: "hidden", squash: "LOGISTIC", index: 3, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 2 },
      { from: 1, to: 3, weight: 3 },
      { from: 0, to: 4, weight: 4 },
      { from: 3, to: 4, weight: 5 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Use bulk load path
  creature.bulkLoadInwardConnections();

  const inward3 = creature.inwardConnections(3);
  assertEquals(inward3.length, 3, "Hidden 3 should have 3 inward connections");

  // Verify sorted by from index
  const fromIndices = inward3.map((s) => s.from);
  assertEquals(
    fromIndices,
    [0, 1, 2],
    "Inward connections to neuron 3 should be sorted by from index",
  );
});

Deno.test("inwardConnections sorted order without prebuilt index (linear scan)", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 3 },
      { from: 1, to: 3, weight: 2 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // First call without prebuilt index - uses linear scan
  const inward = creature.inwardConnections(3);
  assertEquals(inward.length, 3, "Should have 3 inward connections");

  // Verify sorted by from index
  const fromIndices = inward.map((s) => s.from);
  assertEquals(
    fromIndices,
    [0, 1, 2],
    "Inward connections should be sorted by from index even without prebuilt index",
  );
});

Deno.test("inwardConnections sorted order after cache clear and re-query", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      { type: "hidden", squash: "LOGISTIC", index: 3, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 2 },
      { from: 1, to: 3, weight: 3 },
      { from: 3, to: 4, weight: 4 },
      { from: 0, to: 4, weight: 5 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Query with prebuilt index
  creature.prebuildInwardIndex();
  const before = creature.inwardConnections(3).map((s) => s.from);

  // Clear cache and query again (may use different code path)
  creature.clearCache();
  const after = creature.inwardConnections(3).map((s) => s.from);

  assertEquals(
    before,
    after,
    "Sorted order should be consistent across cache clears",
  );
  assertEquals(after, [0, 1, 2], "Should be sorted by from index");
});
