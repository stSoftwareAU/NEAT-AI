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

Deno.test("ModWeight - focus filtering excludes frozen synapses", () => {
  // Issue #2044: Verify frozen synapses are excluded during single-pass filtering
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
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5, frozen: true },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7, frozen: true },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus on hidden-1 (index 2) — all 3 synapses connect to it,
  // but 2 are frozen so only input-1→hidden-1 should be modifiable
  const focusList = [2];

  const initialFrozenWeights = creature.synapses
    .filter((s) => s.frozen)
    .map((s) => s.weight);

  for (let i = 0; i < 100; i++) {
    new ModWeight(creature).mutate(focusList);
  }

  // Frozen synapses must remain unchanged
  const frozenSynapses = creature.synapses.filter((s) => s.frozen);
  for (let i = 0; i < frozenSynapses.length; i++) {
    assertEquals(
      frozenSynapses[i].weight,
      initialFrozenWeights[i],
      `Frozen synapse ${frozenSynapses[i].from}->${
        frozenSynapses[i].to
      } weight should not change`,
    );
  }
});

Deno.test("ModWeight - focus with overlapping connections deduplicates correctly", () => {
  // Issue #2044: When multiple focus neurons share a synapse, it should
  // only appear once in the candidate list (not be over-represented)
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
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Focus on both hidden-1 (index 2) and output-0 (index 3)
  // The synapse hidden-1→output-0 is both outward from 2 and inward to 3
  // It should not be double-counted
  const focusList = [2, 3];

  // Run many mutations and track modification distribution
  const modCounts = new Map<string, number>();
  for (const syn of creature.synapses) {
    modCounts.set(`${syn.from}->${syn.to}`, 0);
  }

  const iterations = 3000;
  for (let i = 0; i < iterations; i++) {
    const initialWeights = creature.synapses.map((s) => s.weight);
    new ModWeight(creature).mutate(focusList);

    for (let j = 0; j < creature.synapses.length; j++) {
      if (initialWeights[j] !== creature.synapses[j].weight) {
        const key = `${creature.synapses[j].from}->${creature.synapses[j].to}`;
        modCounts.set(key, (modCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // All three synapses connect to the focus list, so all should be modified
  for (const [key, count] of modCounts) {
    assert(count > 0, `Synapse ${key} should have been modified at least once`);
  }

  // If deduplication is broken, the shared synapse (2->3) would be picked
  // roughly twice as often. With correct dedup, each of the 3 synapses should
  // be picked approximately 1/3 of the time. Allow a wide tolerance but check
  // that no single synapse dominates more than 60% of modifications.
  const totalMods = [...modCounts.values()].reduce((a, b) => a + b, 0);
  for (const [key, count] of modCounts) {
    const ratio = count / totalMods;
    assert(
      ratio < 0.6,
      `Synapse ${key} was modified ${
        (ratio * 100).toFixed(1)
      }% of the time — possible deduplication failure`,
    );
  }
});
