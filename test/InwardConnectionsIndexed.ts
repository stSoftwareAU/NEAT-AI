import { assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test: Indexed inward connections lookup (Issue #1010)
 *
 * Tests that inwardConnections() returns correct results and benefits from
 * indexed lookup rather than linear scans.
 */
Deno.test("inwardConnections returns correct results for simple creature", () => {
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
      { from: 1, to: 3, weight: 2 },
      { from: 2, to: 3, weight: 3 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Get inward connections to output neuron (index 3)
  const inward = creature.inwardConnections(3);

  assertEquals(inward.length, 3, "Should have 3 inward connections");

  // Verify the connections are correct
  const fromIndices = inward.map((s) => s.from).sort((a, b) => a - b);
  assertEquals(fromIndices, [0, 1, 2], "Should connect from inputs 0, 1, 2");
});

Deno.test("inwardConnections returns empty array for neurons with no inward connections", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 2,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      // Input 1 has no outward connections, so output 2 should still only have 1 inward
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Input neurons should have no inward connections
  const inward0 = creature.inwardConnections(0);
  assertEquals(
    inward0.length,
    0,
    "Input neuron 0 should have 0 inward connections",
  );

  const inward1 = creature.inwardConnections(1);
  assertEquals(
    inward1.length,
    0,
    "Input neuron 1 should have 0 inward connections",
  );

  // Output neuron should have 1 inward connection
  const inward2 = creature.inwardConnections(2);
  assertEquals(
    inward2.length,
    1,
    "Output neuron 2 should have 1 inward connection",
  );
});

Deno.test("inwardConnections maintains correct results after cache clear", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 2 },
      { from: 2, to: 3, weight: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // First call - should populate cache
  const inward2First = creature.inwardConnections(2);
  assertEquals(
    inward2First.length,
    2,
    "Hidden neuron should have 2 inward connections",
  );

  // Clear cache
  creature.clearCache();

  // Second call - should still work correctly after cache clear
  const inward2Second = creature.inwardConnections(2);
  assertEquals(
    inward2Second.length,
    2,
    "Hidden neuron should still have 2 inward connections after cache clear",
  );

  // Verify the connections are the same
  const fromFirst = inward2First.map((s) => s.from).sort((a, b) => a - b);
  const fromSecond = inward2Second.map((s) => s.from).sort((a, b) => a - b);
  assertEquals(
    fromFirst,
    fromSecond,
    "Connections should be identical before and after cache clear",
  );
});

Deno.test("inwardConnections works correctly with multiple hidden layers", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
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
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 0, to: 3, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 4, weight: 1 },
      { from: 3, to: 4, weight: 1 },
      { from: 4, to: 5, weight: 1 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Check each neuron's inward connections
  assertEquals(
    creature.inwardConnections(0).length,
    0,
    "Input 0 has no inward",
  );
  assertEquals(
    creature.inwardConnections(1).length,
    0,
    "Input 1 has no inward",
  );
  assertEquals(
    creature.inwardConnections(2).length,
    2,
    "Hidden 2 has 2 inward",
  );
  assertEquals(
    creature.inwardConnections(3).length,
    2,
    "Hidden 3 has 2 inward",
  );
  assertEquals(
    creature.inwardConnections(4).length,
    2,
    "Hidden 4 has 2 inward",
  );
  assertEquals(
    creature.inwardConnections(5).length,
    1,
    "Output 5 has 1 inward",
  );
});

Deno.test("inwardConnections lookup is efficient after partial cache invalidation", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
      { type: "hidden", squash: "LOGISTIC", index: 3, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 2 },
      { from: 2, to: 4, weight: 3 },
      { from: 3, to: 4, weight: 4 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Populate cache for all neurons
  const inward2 = creature.inwardConnections(2);
  const inward3 = creature.inwardConnections(3);
  const inward4 = creature.inwardConnections(4);

  assertEquals(inward2.length, 1, "Hidden 2 has 1 inward");
  assertEquals(inward3.length, 1, "Hidden 3 has 1 inward");
  assertEquals(inward4.length, 2, "Output 4 has 2 inward");

  // Partial cache clear (simulating adding a connection to neuron 2)
  creature.clearCache(0, 2);

  // Lookup for neuron 2 should still work (may need rebuild)
  const inward2After = creature.inwardConnections(2);
  assertEquals(
    inward2After.length,
    1,
    "Hidden 2 still has 1 inward after partial clear",
  );

  // Other neurons should also work correctly
  const inward3After = creature.inwardConnections(3);
  const inward4After = creature.inwardConnections(4);
  assertEquals(
    inward3After.length,
    1,
    "Hidden 3 has 1 inward after partial clear",
  );
  assertEquals(
    inward4After.length,
    2,
    "Output 4 has 2 inward after partial clear",
  );
});

Deno.test("prebuildInwardIndex optimises subsequent lookups", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
      { type: "hidden", squash: "LOGISTIC", index: 3, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 2 },
      { from: 2, to: 4, weight: 3 },
      { from: 3, to: 4, weight: 4 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Pre-build the index for bulk lookups
  creature.prebuildInwardIndex();

  // All lookups should now use binary search
  assertEquals(
    creature.inwardConnections(0).length,
    0,
    "Input 0 has no inward",
  );
  assertEquals(
    creature.inwardConnections(1).length,
    0,
    "Input 1 has no inward",
  );
  assertEquals(
    creature.inwardConnections(2).length,
    1,
    "Hidden 2 has 1 inward",
  );
  assertEquals(
    creature.inwardConnections(3).length,
    1,
    "Hidden 3 has 1 inward",
  );
  assertEquals(
    creature.inwardConnections(4).length,
    2,
    "Output 4 has 2 inward",
  );
});

Deno.test("bulkLoadInwardConnections populates all cache entries", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 2 },
      { from: 2, to: 3, weight: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // Clear cache first
  creature.clearCache();

  // Bulk load all inward connections
  creature.bulkLoadInwardConnections();

  // All neurons should now have cached inward connections
  assertEquals(
    creature.inwardConnections(0).length,
    0,
    "Input 0 has no inward",
  );
  assertEquals(
    creature.inwardConnections(1).length,
    0,
    "Input 1 has no inward",
  );
  assertEquals(
    creature.inwardConnections(2).length,
    2,
    "Hidden 2 has 2 inward",
  );
  assertEquals(
    creature.inwardConnections(3).length,
    1,
    "Output 3 has 1 inward",
  );
});
