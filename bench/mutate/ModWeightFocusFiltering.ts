/**
 * Benchmark: ModWeight focus filtering allocation reduction (Issue #2124)
 *
 * Compares the old triple-allocation approach (Set<Synapse> → Array.from → .filter)
 * with the new single-pass approach (Set<number> dedup + inline frozen check).
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/mutate/ModWeightFocusFiltering.ts
 */
import { Creature } from "@creature";
import { ModWeight } from "@mutate/ModWeight.ts";

/**
 * Creates a test creature with a configurable number of hidden neurons
 * and dense connectivity to exercise focus filtering.
 */
function createTestCreature(hiddenCount: number): Creature {
  const neurons = [];
  const synapses = [];

  // Hidden layer
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      bias: 0,
      squash: "IDENTITY",
    });
  }

  // Output neuron
  neurons.push({
    type: "output" as const,
    uuid: "output-0",
    bias: 0,
    squash: "IDENTITY",
  });

  // Connect inputs to hidden neurons
  for (let h = 0; h < hiddenCount; h++) {
    for (let inp = 0; inp < 3; inp++) {
      synapses.push({
        fromUUID: `input-${inp}`,
        toUUID: `hidden-${h}`,
        weight: Math.random() - 0.5,
        frozen: Math.random() < 0.2 ? true : undefined, // ~20% frozen
      });
    }
  }

  // Connect hidden neurons to output
  for (let h = 0; h < hiddenCount; h++) {
    synapses.push({
      fromUUID: `hidden-${h}`,
      toUUID: "output-0",
      weight: Math.random() - 0.5,
    });
  }

  // Some inter-hidden connections for overlap
  for (let h = 0; h < hiddenCount - 1; h++) {
    synapses.push({
      fromUUID: `hidden-${h}`,
      toUUID: `hidden-${h + 1}`,
      weight: Math.random() - 0.5,
    });
  }

  return Creature.fromJSON({ input: 3, output: 1, neurons, synapses }, true);
}

// --- Old approach: Set<Synapse> → Array.from → .filter ---

function oldFocusFilter(creature: Creature, focusList: number[]) {
  const seen = new Set<InstanceType<typeof Object>>();
  for (const focusIndex of focusList) {
    for (const syn of creature.outwardConnections(focusIndex)) {
      seen.add(syn);
    }
    for (const syn of creature.inwardConnections(focusIndex)) {
      seen.add(syn);
    }
  }
  return Array.from(seen).filter((s) => !(s as { frozen?: boolean }).frozen);
}

// --- New approach: single-pass with Set<number> ---

function newFocusFilter(creature: Creature, focusList: number[]) {
  const seen = new Set<number>();
  const neuronCount = creature.neurons.length;
  const result: { from: number; to: number; frozen?: boolean }[] = [];
  for (const focusIndex of focusList) {
    for (const syn of creature.outwardConnections(focusIndex)) {
      if (!syn.frozen) {
        const key = syn.from * neuronCount + syn.to;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(syn);
        }
      }
    }
    for (const syn of creature.inwardConnections(focusIndex)) {
      if (!syn.frozen) {
        const key = syn.from * neuronCount + syn.to;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(syn);
        }
      }
    }
  }
  return result;
}

// Small creature (5 hidden neurons, typical focus size)
const smallCreature = createTestCreature(5);
const smallFocus = [0, 3, 4]; // 3 focus neurons

// Medium creature (20 hidden neurons)
const medCreature = createTestCreature(20);
const medFocus = [0, 3, 5, 8, 12, 15]; // 6 focus neurons

Deno.bench("Old: Set<Synapse> → Array.from → filter (small)", () => {
  oldFocusFilter(smallCreature, smallFocus);
});

Deno.bench("New: single-pass Set<number> (small)", () => {
  newFocusFilter(smallCreature, smallFocus);
});

Deno.bench("Old: Set<Synapse> → Array.from → filter (medium)", () => {
  oldFocusFilter(medCreature, medFocus);
});

Deno.bench("New: single-pass Set<number> (medium)", () => {
  newFocusFilter(medCreature, medFocus);
});

// End-to-end: full ModWeight mutation with focus (uses the new implementation)
Deno.bench("ModWeight.mutate with focus (medium creature)", () => {
  new ModWeight(medCreature).mutate(medFocus);
});
