/**
 * Benchmark: Linear vs Binary search disconnect comparison (Issue #1101)
 *
 * This benchmark compares the performance of linear search vs binary search
 * for the disconnect() operation.
 *
 * Run with: deno bench --allow-read bench/DisconnectLinearVsBinary.ts
 */

import { Creature } from "../src/Creature.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import type { Synapse } from "../src/architecture/Synapse.ts";

/**
 * Creates a creature with a specified approximate number of synapses.
 */
function createLargeCreature(targetSynapses: number): Creature {
  const inputCount = 50;
  const outputCount = 5;
  const hiddenCount = Math.ceil(targetSynapses / (inputCount + outputCount));

  const creature = new Creature(inputCount, outputCount, {
    layers: [{ count: hiddenCount, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });

  return creature;
}

/**
 * Linear search implementation (old approach - O(n))
 */
function disconnectLinear(
  synapses: Synapse[],
  from: number,
  to: number,
): number {
  for (let i = 0; i < synapses.length; i++) {
    const connection = synapses[i];
    if (connection.from === from && connection.to === to) {
      return i;
    }
  }
  return -1;
}

/**
 * Binary search implementation (new approach - O(log n))
 */
function disconnectBinary(
  synapses: Synapse[],
  from: number,
  to: number,
): number {
  let low = 0;
  let high = synapses.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from) {
      low = mid + 1;
    } else if (syn.from > from) {
      high = mid - 1;
    } else {
      // syn.from === from, now compare `to`
      if (syn.to < to) {
        low = mid + 1;
      } else if (syn.to > to) {
        high = mid - 1;
      } else {
        return mid; // Found exact match
      }
    }
  }

  return -1; // Not found
}

// Create creatures of different sizes
const sizes = [100, 1000, 5000, 10000, 20000];
const creatures: Map<number, Creature> = new Map();

for (const size of sizes) {
  creatures.set(size, createLargeCreature(size));
}

console.log("Creature sizes:");
for (const [targetSize, creature] of creatures) {
  console.log(
    `  Target ${targetSize}: ${creature.neurons.length} neurons, ${creature.synapses.length} synapses`,
  );
}
console.log("");

// Test lookups at different positions
const positions = ["first", "middle", "last"] as const;

for (const size of sizes) {
  const creature = creatures.get(size)!;
  const synapses = creature.synapses;
  const len = synapses.length;

  // Prepare test cases
  const testCases = {
    first: { from: synapses[0].from, to: synapses[0].to },
    middle: {
      from: synapses[Math.floor(len / 2)].from,
      to: synapses[Math.floor(len / 2)].to,
    },
    last: { from: synapses[len - 1].from, to: synapses[len - 1].to },
  };

  for (const pos of positions) {
    const { from, to } = testCases[pos];

    Deno.bench(
      `linear  ${size.toString().padStart(5)} synapses, ${pos.padEnd(6)}`,
      { group: `${size}-synapses` },
      () => {
        // Run 100 lookups to get stable measurements
        for (let i = 0; i < 100; i++) {
          disconnectLinear(synapses, from, to);
        }
      },
    );

    Deno.bench(
      `binary  ${size.toString().padStart(5)} synapses, ${pos.padEnd(6)}`,
      { group: `${size}-synapses` },
      () => {
        // Run 100 lookups to get stable measurements
        for (let i = 0; i < 100; i++) {
          disconnectBinary(synapses, from, to);
        }
      },
    );
  }
}

// Not found case
const largeCreature = creatures.get(10000)!;
Deno.bench(
  `linear  10000 synapses, not found`,
  { group: "not-found" },
  () => {
    for (let i = 0; i < 100; i++) {
      disconnectLinear(largeCreature.synapses, 99999, 99999);
    }
  },
);

Deno.bench(
  `binary  10000 synapses, not found`,
  { group: "not-found" },
  () => {
    for (let i = 0; i < 100; i++) {
      disconnectBinary(largeCreature.synapses, 99999, 99999);
    }
  },
);
