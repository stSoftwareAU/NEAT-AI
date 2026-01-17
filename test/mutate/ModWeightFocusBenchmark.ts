/**
 * Benchmark tests for ModWeight mutation focus optimisation (Issue #1096).
 *
 * This benchmark measures the performance improvement from using indexed
 * synapse lookups (outwardConnections/inwardConnections) instead of scanning
 * all synapses when a focus list is provided.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a large densely-connected creature for benchmarking.
 * This simulates production workloads with thousands of synapses.
 */
function createLargeCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < hiddenNeurons; i++) {
    addNeuron.mutate();
  }

  // Add more connections to create a denser network
  const available = creature.getAvailableConnections();
  const toAdd = Math.min(available.length, 5000);
  for (let i = 0; i < toAdd; i++) {
    const [from, to] = available[i];
    creature.connect(from, to, Math.random() * 2 - 1);
  }

  return creature;
}

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

Deno.test("ModWeight - benchmark: 1000 mutations with focus list on large creature", () => {
  // Create a large creature with many synapses (target: 10,000+)
  const creature = createLargeCreature(50, 10, 300);

  console.log(`\n--- ModWeight Benchmark Setup ---`);
  console.log(`Neurons: ${creature.neurons.length}`);
  console.log(`Synapses: ${creature.synapses.length}`);

  // Small focus list (10 neurons) - representative of production use
  const focusList: number[] = [];
  for (let i = 0; i < 10; i++) {
    focusList.push(Math.floor(Math.random() * creature.neurons.length));
  }

  const iterations = 1000;

  // Benchmark with focus list
  const startWithFocus = performance.now();
  let successCountWithFocus = 0;
  for (let i = 0; i < iterations; i++) {
    const modWeight = new ModWeight(creature);
    if (modWeight.mutate(focusList)) {
      successCountWithFocus++;
    }
  }
  const endWithFocus = performance.now();
  const timeWithFocus = endWithFocus - startWithFocus;

  // Benchmark without focus list (baseline)
  const startNoFocus = performance.now();
  let successCountNoFocus = 0;
  for (let i = 0; i < iterations; i++) {
    const modWeight = new ModWeight(creature);
    if (modWeight.mutate()) {
      successCountNoFocus++;
    }
  }
  const endNoFocus = performance.now();
  const timeNoFocus = endNoFocus - startNoFocus;

  console.log(
    `\n--- ModWeight Benchmark Results (${iterations} iterations) ---`,
  );
  console.log(
    `With focus list (${focusList.length} items): ${
      timeWithFocus.toFixed(2)
    }ms`,
  );
  console.log(
    `  Success rate: ${(successCountWithFocus / iterations * 100).toFixed(1)}%`,
  );
  console.log(`  Per mutation: ${(timeWithFocus / iterations).toFixed(4)}ms`);
  console.log(`Without focus list: ${timeNoFocus.toFixed(2)}ms`);
  console.log(
    `  Success rate: ${(successCountNoFocus / iterations * 100).toFixed(1)}%`,
  );
  console.log(`  Per mutation: ${(timeNoFocus / iterations).toFixed(4)}ms`);
  console.log(
    `Ratio (focus/no-focus): ${(timeWithFocus / timeNoFocus).toFixed(2)}x`,
  );
  console.log(`-------------------------------------------------\n`);

  // Performance assertion: focused mutations should complete in reasonable time
  // With the optimised indexed lookup, 1000 focused mutations on a 6000+ synapse
  // creature should complete in under 100ms (typically ~10-15ms)
  assert(
    timeWithFocus < 100,
    `Expected 1000 focused mutations to complete in under 100ms, took ${
      timeWithFocus.toFixed(2)
    }ms`,
  );
});

Deno.test("ModWeight - benchmark: comparison with varying synapse counts", () => {
  const iterations = 500;
  const focusSize = 10;

  const testCases = [
    { inputs: 20, outputs: 5, hidden: 50, expectedSynapses: ">200" },
    { inputs: 30, outputs: 10, hidden: 150, expectedSynapses: ">1000" },
    { inputs: 50, outputs: 10, hidden: 300, expectedSynapses: ">5000" },
  ];

  console.log(`\n--- ModWeight Scaling Benchmark ---`);

  for (const testCase of testCases) {
    const creature = createLargeCreature(
      testCase.inputs,
      testCase.outputs,
      testCase.hidden,
    );

    const focusList: number[] = [];
    for (let i = 0; i < focusSize; i++) {
      focusList.push(Math.floor(Math.random() * creature.neurons.length));
    }

    const startWithFocus = performance.now();
    for (let i = 0; i < iterations; i++) {
      const modWeight = new ModWeight(creature);
      modWeight.mutate(focusList);
    }
    const timeWithFocus = performance.now() - startWithFocus;

    const startNoFocus = performance.now();
    for (let i = 0; i < iterations; i++) {
      const modWeight = new ModWeight(creature);
      modWeight.mutate();
    }
    const timeNoFocus = performance.now() - startNoFocus;

    console.log(
      `Synapses: ${creature.synapses.length} | Focus: ${
        timeWithFocus.toFixed(1)
      }ms | No-focus: ${timeNoFocus.toFixed(1)}ms | Ratio: ${
        (timeWithFocus / timeNoFocus).toFixed(2)
      }x`,
    );
  }

  console.log(`-----------------------------------\n`);
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
