/**
 * Benchmark: ModWeight focus filtering allocation reduction (Issue #2044)
 *
 * Measures the performance of focus-based connection filtering in ModWeight
 * mutation with creatures of varying sizes and focus list lengths.
 *
 * The optimisation:
 * - Previously: Set<Synapse> → Array.from(seen) → .filter(!frozen) (3 allocations)
 * - Now: Single-pass building result array directly with inline dedup + frozen check
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/ModWeightFocusFiltering.ts
 */
import { Creature } from "../src/Creature.ts";
import { ModWeight } from "../src/mutate/ModWeight.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

/**
 * Creates a creature with a specified number of hidden neurons and dense
 * connectivity, simulating creatures with 100-500 synapses.
 */
function createCreature(hiddenCount: number): Creature {
  const inputCount = 5;
  const outputCount = 3;

  const neurons: CreatureInternal["neurons"] = [];

  // Hidden neurons
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      bias: Math.random() * 0.2 - 0.1,
      index: inputCount + i,
      type: "hidden",
      squash: "TANH",
    });
  }

  // Output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      bias: Math.random() * 0.2 - 0.1,
      index: inputCount + hiddenCount + i,
      type: "output",
      squash: "IDENTITY",
    });
  }

  const synapses: CreatureInternal["synapses"] = [];

  // Connect inputs to first layer of hidden neurons
  const firstLayerSize = Math.min(hiddenCount, 10);
  for (let i = 0; i < inputCount; i++) {
    for (let h = 0; h < firstLayerSize; h++) {
      synapses.push({
        weight: Math.random() * 2 - 1,
        from: i,
        to: inputCount + h,
      });
    }
  }

  // Connect hidden neurons in a feed-forward pattern
  for (let h = 0; h < hiddenCount - 1; h++) {
    const fromIdx = inputCount + h;
    // Connect to next few hidden neurons
    for (let j = 1; j <= Math.min(3, hiddenCount - h - 1); j++) {
      synapses.push({
        weight: Math.random() * 2 - 1,
        from: fromIdx,
        to: inputCount + h + j,
      });
    }
  }

  // Connect last hidden neurons to outputs
  const lastLayerStart = Math.max(0, hiddenCount - 5);
  for (let h = lastLayerStart; h < hiddenCount; h++) {
    for (let o = 0; o < outputCount; o++) {
      synapses.push({
        weight: Math.random() * 2 - 1,
        from: inputCount + h,
        to: inputCount + hiddenCount + o,
      });
    }
  }

  // Freeze some synapses to exercise the frozen filtering
  const frozenCount = Math.floor(synapses.length * 0.1);
  for (let i = 0; i < frozenCount; i++) {
    const idx = Math.floor(Math.random() * synapses.length);
    synapses[idx].frozen = true;
  }

  const json: CreatureInternal = {
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  };

  return Creature.fromJSON(json);
}

/**
 * Creates a focus list of neuron indices centred around hidden neurons.
 */
function createFocusList(
  creature: Creature,
  focusSize: number,
): number[] {
  const inputCount = creature.input;
  const totalNeurons = creature.neurons.length;
  const focusList: number[] = [];

  for (let i = 0; i < focusSize && i < totalNeurons; i++) {
    // Spread focus across hidden and output neurons
    const idx = inputCount + (i * 3) % (totalNeurons - inputCount);
    if (!focusList.includes(idx)) {
      focusList.push(idx);
    }
  }

  return focusList;
}

// --- Small creature (~100 synapses) ---
const smallCreature = createCreature(20);
const smallFocus3 = createFocusList(smallCreature, 3);
const smallFocus10 = createFocusList(smallCreature, 10);

console.log("=== ModWeight Focus Filtering Benchmark (Issue #2044) ===");
console.log(
  `Small creature: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);

Deno.bench({
  name: "Small creature (~100 syn), focus=3",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(smallCreature).mutate(smallFocus3);
  },
});

Deno.bench({
  name: "Small creature (~100 syn), focus=10",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(smallCreature).mutate(smallFocus10);
  },
});

// --- Medium creature (~250 synapses) ---
const mediumCreature = createCreature(60);
const mediumFocus3 = createFocusList(mediumCreature, 3);
const mediumFocus10 = createFocusList(mediumCreature, 10);
const mediumFocus20 = createFocusList(mediumCreature, 20);

console.log(
  `Medium creature: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);

Deno.bench({
  name: "Medium creature (~250 syn), focus=3",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(mediumCreature).mutate(mediumFocus3);
  },
});

Deno.bench({
  name: "Medium creature (~250 syn), focus=10",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(mediumCreature).mutate(mediumFocus10);
  },
});

Deno.bench({
  name: "Medium creature (~250 syn), focus=20",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(mediumCreature).mutate(mediumFocus20);
  },
});

// --- Large creature (~500 synapses) ---
const largeCreature = createCreature(130);
const largeFocus5 = createFocusList(largeCreature, 5);
const largeFocus15 = createFocusList(largeCreature, 15);
const largeFocus30 = createFocusList(largeCreature, 30);

console.log(
  `Large creature: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

Deno.bench({
  name: "Large creature (~500 syn), focus=5",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(largeCreature).mutate(largeFocus5);
  },
});

Deno.bench({
  name: "Large creature (~500 syn), focus=15",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(largeCreature).mutate(largeFocus15);
  },
});

Deno.bench({
  name: "Large creature (~500 syn), focus=30",
  group: "ModWeight focus filtering",
  fn() {
    new ModWeight(largeCreature).mutate(largeFocus30);
  },
});

// --- Baseline: No focus list (all synapses) ---
Deno.bench({
  name: "Large creature (~500 syn), no focus (baseline)",
  group: "ModWeight focus filtering",
  baseline: true,
  fn() {
    new ModWeight(largeCreature).mutate();
  },
});
