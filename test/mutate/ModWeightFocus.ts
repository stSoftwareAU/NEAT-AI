/**
 * Functional tests for ModWeight mutation focus optimisation (Issue #1096).
 *
 * These tests verify that the ModWeight mutation correctly modifies weights
 * when a focus list is provided, and handles edge cases properly.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ModWeight - mutate correctly modifies weight with focus list", () => {
  const json = {
    input: 3,
    output: 2,
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
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus on input-0 (index 0) and hidden-1 (index 3)
  // This should only allow modification of synapses connected to indices 0 or 3
  const focusList = [0, 3];

  // Record initial weights
  const initialWeights = creature.synapses.map((s) => s.weight);

  // Mutate multiple times to increase chance of seeing a change
  let changed = false;
  for (let i = 0; i < 100 && !changed; i++) {
    const result = new ModWeight(creature).mutate(focusList);
    if (result) changed = true;
  }

  assert(changed, "ModWeight should have modified at least one weight");

  // Verify that at least one weight changed
  const newWeights = creature.synapses.map((s) => s.weight);
  let weightChanged = false;
  for (let i = 0; i < initialWeights.length; i++) {
    if (initialWeights[i] !== newWeights[i]) {
      weightChanged = true;
      // Verify the changed synapse is connected to the focus list
      const synapse = creature.synapses[i];
      const isConnectedToFocus = focusList.includes(synapse.from) ||
        focusList.includes(synapse.to);
      assert(
        isConnectedToFocus,
        `Modified synapse (${synapse.from}->${synapse.to}) should be connected to focus list`,
      );
      break;
    }
  }

  assert(weightChanged, "At least one weight should have changed");
});

Deno.test("ModWeight - mutate works without focus list", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const initialWeights = creature.synapses.map((s) => s.weight);

  // Mutate without focus list - should work on all synapses
  let changed = false;
  for (let i = 0; i < 100 && !changed; i++) {
    const result = new ModWeight(creature).mutate();
    if (result) changed = true;
  }

  assert(changed, "ModWeight should have modified at least one weight");

  const newWeights = creature.synapses.map((s) => s.weight);
  let weightChanged = false;
  for (let i = 0; i < initialWeights.length; i++) {
    if (initialWeights[i] !== newWeights[i]) {
      weightChanged = true;
      break;
    }
  }

  assert(weightChanged, "At least one weight should have changed");
});

Deno.test("ModWeight - returns false when no synapses exist", () => {
  // Create a creature with no synapses
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(creature);

  const result = modWeight.mutate();
  assertEquals(result, false, "Should return false when no synapses exist");
});

Deno.test("ModWeight - focus list with no connected synapses returns false", () => {
  const json = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(creature);

  // Focus on input-2 (index 2) which has no connections
  const focusList = [2];

  const result = modWeight.mutate(focusList);
  assertEquals(
    result,
    false,
    "Should return false when focus list has no connected synapses",
  );
});

Deno.test("ModWeight - empty focus list treated as no focus", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(creature);

  // Empty focus list should behave same as no focus list
  const result = modWeight.mutate([]);
  assertEquals(result, true, "Empty focus list should allow all synapses");
});

Deno.test("ModWeight - collects synapses from both inward and outward connections", () => {
  // Create a network where a focus neuron has both inward and outward connections
  const json = {
    input: 2,
    output: 2,
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
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 }, // inward to hidden-1
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.6 }, // not connected to hidden-1
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 }, // outward from hidden-1
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus only on hidden-1 (index 2)
  const focusList = [2];

  // Track which synapses get modified over many iterations
  const modifiedSynapses = new Set<string>();

  for (let i = 0; i < 1000; i++) {
    const initialWeights = creature.synapses.map((s) => s.weight);
    const modWeight = new ModWeight(creature);
    modWeight.mutate(focusList);

    for (let j = 0; j < creature.synapses.length; j++) {
      if (initialWeights[j] !== creature.synapses[j].weight) {
        modifiedSynapses.add(
          `${creature.synapses[j].from}->${creature.synapses[j].to}`,
        );
      }
    }
  }

  // Should have modified synapses connected to hidden-1 (both inward and outward)
  // input-0 (0) -> hidden-1 (2): inward connection to focus
  // hidden-1 (2) -> output-0 (3): outward connection from focus
  assert(
    modifiedSynapses.has("0->2"),
    "Should modify inward connection to focused neuron",
  );
  assert(
    modifiedSynapses.has("2->3"),
    "Should modify outward connection from focused neuron",
  );

  // Should NOT have modified input-1 (1) -> output-1 (4) as it's not connected to focus
  assert(
    !modifiedSynapses.has("1->4"),
    "Should NOT modify synapse not connected to focused neuron",
  );
});
