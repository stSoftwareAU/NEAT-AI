/**
 * Tests for iterative BFS-based focus closure (Issue #1443).
 *
 * Verifies that the focus closure correctly identifies all neurons
 * reachable downstream from focus neurons, and handles edge cases
 * like self-connections, disconnected components, and diamond topologies.
 */
import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a simple chain: input(0) -> hidden(1) -> hidden(2) -> output(3)
 */
function createChainNetwork(): CreatureInternal {
  return {
    neurons: [
      { type: "input", index: 0 },
      { type: "hidden", index: 1, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 2, bias: 0, squash: "LOGISTIC" },
      { type: "output", index: 3, bias: 0, squash: "LOGISTIC" },
    ],
    synapses: [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    input: 1,
    output: 1,
  };
}

/**
 * Creates a diamond topology:
 *   input(0) -> hidden(1) -> hidden(3) -> output(4)
 *   input(0) -> hidden(2) -> hidden(3)
 */
function createDiamondNetwork(): CreatureInternal {
  return {
    neurons: [
      { type: "input", index: 0 },
      { type: "hidden", index: 1, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 2, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 3, bias: 0, squash: "LOGISTIC" },
      { type: "output", index: 4, bias: 0, squash: "LOGISTIC" },
    ],
    synapses: [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 1 },
      { from: 3, to: 4, weight: 1 },
    ],
    input: 1,
    output: 1,
  };
}

/**
 * Creates a network with two disconnected paths:
 *   input(0) -> hidden(2) -> output(4)
 *   input(1) -> hidden(3) -> output(4)
 */
function createDisconnectedPathsNetwork(): CreatureInternal {
  return {
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "hidden", index: 2, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 3, bias: 0, squash: "LOGISTIC" },
      { type: "output", index: 4, bias: 0, squash: "LOGISTIC" },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 4, weight: 1 },
      { from: 3, to: 4, weight: 1 },
    ],
    input: 2,
    output: 1,
  };
}

Deno.test("focus closure - chain transitive reachability", () => {
  const creature = Creature.fromJSON(createChainNetwork());

  // Focus on input(0): everything downstream should be in focus
  assertEquals(creature.inFocus(0, [0]), true, "input 0 directly in focus");
  assertEquals(creature.inFocus(1, [0]), true, "hidden 1 downstream of 0");
  assertEquals(creature.inFocus(2, [0]), true, "hidden 2 downstream of 0");
  assertEquals(creature.inFocus(3, [0]), true, "output 3 downstream of 0");
});

Deno.test("focus closure - mid-chain focus", () => {
  const creature = Creature.fromJSON(createChainNetwork());

  // Focus on hidden(1): upstream input(0) should NOT be in focus,
  // but downstream hidden(2) and output(3) should be
  assertEquals(
    creature.inFocus(0, [1]),
    false,
    "input 0 is upstream of focus, not in focus",
  );
  assertEquals(creature.inFocus(1, [1]), true, "hidden 1 directly in focus");
  assertEquals(
    creature.inFocus(2, [1]),
    true,
    "hidden 2 downstream of focus",
  );
  assertEquals(
    creature.inFocus(3, [1]),
    true,
    "output 3 downstream of focus",
  );
});

Deno.test("focus closure - diamond topology", () => {
  const creature = Creature.fromJSON(createDiamondNetwork());

  // Focus on input(0): all neurons should be in focus
  assertEquals(creature.inFocus(0, [0]), true, "input 0 directly in focus");
  assertEquals(creature.inFocus(1, [0]), true, "hidden 1 downstream");
  assertEquals(creature.inFocus(2, [0]), true, "hidden 2 downstream");
  assertEquals(creature.inFocus(3, [0]), true, "hidden 3 downstream");
  assertEquals(creature.inFocus(4, [0]), true, "output 4 downstream");
});

Deno.test("focus closure - disconnected paths only follow focused path", () => {
  const creature = Creature.fromJSON(createDisconnectedPathsNetwork());

  // Focus on input(0) only: hidden(2) and output(4) downstream,
  // but input(1) and hidden(3) are on a separate path
  assertEquals(creature.inFocus(0, [0]), true, "input 0 directly in focus");
  assertEquals(
    creature.inFocus(1, [0]),
    false,
    "input 1 on separate path",
  );
  assertEquals(
    creature.inFocus(2, [0]),
    true,
    "hidden 2 downstream of input 0",
  );
  assertEquals(
    creature.inFocus(3, [0]),
    false,
    "hidden 3 on separate path from input 1",
  );
  assertEquals(
    creature.inFocus(4, [0]),
    true,
    "output 4 downstream of input 0",
  );
});

Deno.test("focus closure - multiple focus neurons", () => {
  const creature = Creature.fromJSON(createDisconnectedPathsNetwork());

  // Focus on both inputs: everything should be in focus
  assertEquals(creature.inFocus(0, [0, 1]), true, "input 0 in focus list");
  assertEquals(creature.inFocus(1, [0, 1]), true, "input 1 in focus list");
  assertEquals(creature.inFocus(2, [0, 1]), true, "hidden 2 downstream");
  assertEquals(creature.inFocus(3, [0, 1]), true, "hidden 3 downstream");
  assertEquals(creature.inFocus(4, [0, 1]), true, "output 4 downstream");
});

Deno.test("focus closure - empty focus list returns true for all", () => {
  const creature = Creature.fromJSON(createChainNetwork());

  for (let i = 0; i < creature.neurons.length; i++) {
    assertEquals(
      creature.inFocus(i, []),
      true,
      `neuron ${i} should be in focus with empty list`,
    );
    assertEquals(
      creature.inFocus(i, undefined),
      true,
      `neuron ${i} should be in focus with undefined list`,
    );
  }
});

Deno.test("focus closure - cache invalidation on focus list change", () => {
  const creature = Creature.fromJSON(createDisconnectedPathsNetwork());

  // First call with focus on input 0
  assertEquals(creature.inFocus(3, [0]), false, "hidden 3 not in focus of [0]");

  // Change focus list to input 1
  assertEquals(creature.inFocus(3, [1]), true, "hidden 3 in focus of [1]");

  // hidden 2 should now NOT be in focus
  assertEquals(creature.inFocus(2, [1]), false, "hidden 2 not in focus of [1]");
});

Deno.test("focus closure - self-connection marks neuron as in focus", () => {
  // Create a network with a self-connection on a hidden neuron
  const network: CreatureInternal = {
    neurons: [
      { type: "input", index: 0 },
      { type: "hidden", index: 1, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 2, bias: 0, squash: "LOGISTIC" },
      { type: "output", index: 3, bias: 0, squash: "LOGISTIC" },
    ],
    synapses: [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 2, weight: 0.5 }, // self-connection on hidden 2
      { from: 2, to: 3, weight: 1 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(network);

  // Focus on a neuron NOT connected to the self-connected neuron's path
  // In the original code, self-connected neurons are always considered in focus
  // when a focus list is present
  const focusList = [0];

  // Hidden 2 has a self-connection and is downstream of input 0,
  // so it should be in focus
  assertEquals(
    creature.inFocus(2, focusList),
    true,
    "self-connected neuron downstream of focus should be in focus",
  );
});

Deno.test("focus closure - consistent results with inFocus.json test data", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  // Compute all focus results for focusList [1]
  const focusList = [1];
  const results: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    results.push(creature.inFocus(i, focusList));
  }

  // Verify consistency: calling again should return same results
  for (let i = 0; i < creature.neurons.length; i++) {
    assertEquals(
      creature.inFocus(i, focusList),
      results[i],
      `neuron ${i} should have consistent result`,
    );
  }

  // Verify there are both positive and negative results
  const positiveCount = results.filter((r) => r).length;
  const negativeCount = results.filter((r) => !r).length;
  assertEquals(positiveCount > 0, true, "should have some neurons in focus");
  assertEquals(
    negativeCount > 0,
    true,
    "should have some neurons not in focus",
  );
});
