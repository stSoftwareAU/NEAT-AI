/**
 * Benchmark for Set intersection optimisation in genetic compatibility.
 *
 * Issue #1033: Use direct Set iteration instead of spread + filter pattern.
 *
 * This benchmark compares:
 * 1. Original approach: [...set].filter() - spreads to array, filters, creates new Set
 * 2. Optimised approach: Direct for-of iteration without intermediate array
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/GeneticCompatibilitySetIntersection.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { geneticCompatibility } from "../src/breed/GeneticCompatibility.ts";

/**
 * Creates a creature with many hidden neurons for benchmarking Set intersection.
 */
function createCreatureWithHiddenNeurons(
  hiddenNeuronCount: number,
  prefix: string,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add hidden neurons
  for (let i = 0; i < hiddenNeuronCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: "TANH",
      bias: 0.1,
    });
  }

  // Add output neurons
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect inputs to first few hidden neurons
  const firstLayerSize = Math.min(hiddenNeuronCount, 10);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < firstLayerSize; j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-hidden-${j}`,
        weight: 0.5,
      });
    }
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenNeuronCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: 0.5,
    });
  }

  // Connect last hidden neurons to output
  const lastIdx = hiddenNeuronCount - 1;
  if (lastIdx >= 0) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${lastIdx}`,
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 5,
    output: 1,
  });

  creature.validate();
  return creature;
}

/**
 * Original spread + filter approach for Set intersection.
 * This is what lines 45-47 previously did.
 */
function spreadFilterIntersection(
  setA: Set<string>,
  setB: Set<string>,
): number {
  const smallestSet = setA.size < setB.size ? setA : setB;
  const otherSet = setA.size < setB.size ? setB : setA;

  const matchingItems = new Set(
    [...smallestSet].filter((n) => otherSet.has(n)),
  );
  return matchingItems.size;
}

/**
 * Optimised direct iteration approach for Set intersection.
 * This is the new approach from issue #1033.
 */
function directIterationIntersection(
  setA: Set<string>,
  setB: Set<string>,
): number {
  const smallestSet = setA.size < setB.size ? setA : setB;
  const otherSet = setA.size < setB.size ? setB : setA;

  let count = 0;
  for (const item of smallestSet) {
    if (otherSet.has(item)) {
      count++;
    }
  }
  return count;
}

// Create creatures with different amounts of overlap
const creature1 = createCreatureWithHiddenNeurons(500, "creature1");
const creature2 = createCreatureWithHiddenNeurons(500, "creature2");

// Create creatures that share some neurons (50% overlap)
const sharedNeurons: CreatureExport["neurons"] = [];
const sharedSynapses: CreatureExport["synapses"] = [];

for (let i = 0; i < 250; i++) {
  sharedNeurons.push({
    type: "hidden",
    uuid: `shared-hidden-${i}`,
    squash: "TANH",
    bias: 0.1,
  });
}
for (let i = 0; i < 250; i++) {
  sharedNeurons.push({
    type: "hidden",
    uuid: `unique-a-hidden-${i}`,
    squash: "TANH",
    bias: 0.1,
  });
}
sharedNeurons.push({
  type: "output",
  uuid: "output-0",
  squash: "IDENTITY",
  bias: 0,
});

// Connect inputs to first hidden neurons
for (let i = 0; i < 5; i++) {
  sharedSynapses.push({
    fromUUID: `input-${i}`,
    toUUID: `shared-hidden-0`,
    weight: 0.5,
  });
}

// Chain neurons
for (let i = 0; i < 249; i++) {
  sharedSynapses.push({
    fromUUID: `shared-hidden-${i}`,
    toUUID: `shared-hidden-${i + 1}`,
    weight: 0.5,
  });
}
sharedSynapses.push({
  fromUUID: `shared-hidden-249`,
  toUUID: `unique-a-hidden-0`,
  weight: 0.5,
});
for (let i = 0; i < 249; i++) {
  sharedSynapses.push({
    fromUUID: `unique-a-hidden-${i}`,
    toUUID: `unique-a-hidden-${i + 1}`,
    weight: 0.5,
  });
}
sharedSynapses.push({
  fromUUID: `unique-a-hidden-249`,
  toUUID: "output-0",
  weight: 0.5,
});

const creatureA = Creature.fromJSON({
  neurons: sharedNeurons,
  synapses: sharedSynapses,
  input: 5,
  output: 1,
});
creatureA.validate();

// Create creature B with shared neurons plus different unique neurons
const neuronsB: CreatureExport["neurons"] = [];
const synapsesB: CreatureExport["synapses"] = [];

for (let i = 0; i < 250; i++) {
  neuronsB.push({
    type: "hidden",
    uuid: `shared-hidden-${i}`,
    squash: "TANH",
    bias: 0.1,
  });
}
for (let i = 0; i < 250; i++) {
  neuronsB.push({
    type: "hidden",
    uuid: `unique-b-hidden-${i}`,
    squash: "TANH",
    bias: 0.1,
  });
}
neuronsB.push({
  type: "output",
  uuid: "output-0",
  squash: "IDENTITY",
  bias: 0,
});

// Connect inputs to first hidden neurons
for (let i = 0; i < 5; i++) {
  synapsesB.push({
    fromUUID: `input-${i}`,
    toUUID: `shared-hidden-0`,
    weight: 0.5,
  });
}

// Chain neurons
for (let i = 0; i < 249; i++) {
  synapsesB.push({
    fromUUID: `shared-hidden-${i}`,
    toUUID: `shared-hidden-${i + 1}`,
    weight: 0.5,
  });
}
synapsesB.push({
  fromUUID: `shared-hidden-249`,
  toUUID: `unique-b-hidden-0`,
  weight: 0.5,
});
for (let i = 0; i < 249; i++) {
  synapsesB.push({
    fromUUID: `unique-b-hidden-${i}`,
    toUUID: `unique-b-hidden-${i + 1}`,
    weight: 0.5,
  });
}
synapsesB.push({
  fromUUID: `unique-b-hidden-249`,
  toUUID: "output-0",
  weight: 0.5,
});

const creatureB = Creature.fromJSON({
  neurons: neuronsB,
  synapses: synapsesB,
  input: 5,
  output: 1,
});
creatureB.validate();

// Get the hidden neuron sets for benchmarking
const setA = creatureA.getHiddenNeuronUUIDs();
const setB = creatureB.getHiddenNeuronUUIDs();

console.log(`Set A size: ${setA.size}, Set B size: ${setB.size}`);
console.log(
  `Expected overlap: ~250 neurons (shared-hidden-* UUIDs)`,
);

// Verify both approaches return the same result
const spreadResult = spreadFilterIntersection(setA, setB);
const directResult = directIterationIntersection(setA, setB);
console.log(
  `Spread+filter intersection size: ${spreadResult}`,
);
console.log(
  `Direct iteration intersection size: ${directResult}`,
);

if (spreadResult !== directResult) {
  throw new Error(
    `Results don't match: spread=${spreadResult}, direct=${directResult}`,
  );
}

// Benchmark the raw Set intersection approaches
Deno.bench({
  name: "Original: spread + filter intersection",
  fn() {
    spreadFilterIntersection(setA, setB);
  },
});

Deno.bench({
  name: "Optimised: direct iteration intersection",
  fn() {
    directIterationIntersection(setA, setB);
  },
});

// Benchmark the full geneticCompatibility function
Deno.bench({
  name: "Full geneticCompatibility (with 50% overlap)",
  fn() {
    geneticCompatibility(creatureA, creatureB);
  },
});

// Benchmark with no overlap scenario
Deno.bench({
  name: "Full geneticCompatibility (no overlap)",
  fn() {
    geneticCompatibility(creature1, creature2);
  },
});
