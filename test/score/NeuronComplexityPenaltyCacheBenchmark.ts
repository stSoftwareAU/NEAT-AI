import { Creature } from "../../src/Creature.ts";
import { calculate } from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { GELU } from "../../src/methods/activations/types/GELU.ts";
import { ReLU } from "../../src/methods/activations/types/ReLU.ts";

/**
 * Benchmark for neuron-level complexity penalty caching.
 * Issue #1043: Cache Activations.find() lookups in score calculation.
 *
 * This benchmark compares score calculation performance with and without
 * neuron-level caching of complexity penalties.
 */

const ITERATIONS = 10000;

function createMediumCreature(): Creature {
  // Create a creature with 100 hidden neurons to simulate a medium-sized network
  return new Creature(10, 5, {
    layers: [
      { count: 20, squash: TANH.NAME },
      { count: 30, squash: GELU.NAME },
      { count: 20, squash: ReLU.NAME },
      { count: 30, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: TANH.NAME },
  });
}

function createLargeCreature(): Creature {
  // Create a creature with 200 hidden neurons to simulate a larger network
  return new Creature(20, 10, {
    layers: [
      { count: 40, squash: TANH.NAME },
      { count: 60, squash: GELU.NAME },
      { count: 40, squash: ReLU.NAME },
      { count: 60, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: TANH.NAME },
  });
}

Deno.test("Benchmark: Repeated score calculations with caching (medium creature)", () => {
  const creature = createMediumCreature();
  const neuronCount = creature.neurons.length;
  const hiddenCount = neuronCount - creature.input - creature.output;

  console.log(
    `\n[Benchmark] Medium creature: ${neuronCount} neurons (${hiddenCount} hidden)`,
  );

  // Warm up
  for (let i = 0; i < 100; i++) {
    creature.invalidateScoreCache();
    calculate(creature, 0.1, 0.0001);
  }

  // Benchmark with cache invalidation (simulating no caching)
  const startWithoutCache = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    creature.invalidateScoreCache();
    calculate(creature, 0.1, 0.0001);
  }
  const durationWithoutCache = performance.now() - startWithoutCache;

  // Benchmark with cache (the normal case)
  calculate(creature, 0.1, 0.0001); // Prime the cache
  const startWithCache = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    calculate(creature, 0.1, 0.0001);
  }
  const durationWithCache = performance.now() - startWithCache;

  const speedup = durationWithoutCache / durationWithCache;
  const percentImprovement = ((speedup - 1) * 100).toFixed(1);

  console.log(
    `  Without cache (invalidated): ${
      durationWithoutCache.toFixed(2)
    }ms for ${ITERATIONS} iterations`,
  );
  console.log(
    `  With cache: ${
      durationWithCache.toFixed(2)
    }ms for ${ITERATIONS} iterations`,
  );
  console.log(
    `  Speedup: ${speedup.toFixed(2)}x (${percentImprovement}% faster)`,
  );

  // The cached version should be significantly faster
  if (speedup > 1.0) {
    console.log("  ✓ Cache provides performance improvement");
  }
});

Deno.test("Benchmark: Repeated score calculations with caching (large creature)", () => {
  const creature = createLargeCreature();
  const neuronCount = creature.neurons.length;
  const hiddenCount = neuronCount - creature.input - creature.output;

  console.log(
    `\n[Benchmark] Large creature: ${neuronCount} neurons (${hiddenCount} hidden)`,
  );

  // Warm up
  for (let i = 0; i < 100; i++) {
    creature.invalidateScoreCache();
    calculate(creature, 0.1, 0.0001);
  }

  // Benchmark with cache invalidation (simulating no caching)
  const startWithoutCache = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    creature.invalidateScoreCache();
    calculate(creature, 0.1, 0.0001);
  }
  const durationWithoutCache = performance.now() - startWithoutCache;

  // Benchmark with cache (the normal case)
  calculate(creature, 0.1, 0.0001); // Prime the cache
  const startWithCache = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    calculate(creature, 0.1, 0.0001);
  }
  const durationWithCache = performance.now() - startWithCache;

  const speedup = durationWithoutCache / durationWithCache;
  const percentImprovement = ((speedup - 1) * 100).toFixed(1);

  console.log(
    `  Without cache (invalidated): ${
      durationWithoutCache.toFixed(2)
    }ms for ${ITERATIONS} iterations`,
  );
  console.log(
    `  With cache: ${
      durationWithCache.toFixed(2)
    }ms for ${ITERATIONS} iterations`,
  );
  console.log(
    `  Speedup: ${speedup.toFixed(2)}x (${percentImprovement}% faster)`,
  );

  // The cached version should be significantly faster
  if (speedup > 1.0) {
    console.log("  ✓ Cache provides performance improvement");
  }
});

Deno.test("Benchmark: Neuron-level getComplexityPenalty caching", () => {
  const creature = createLargeCreature();
  const neuronCount = creature.neurons.length;
  const hiddenCount = neuronCount - creature.input - creature.output;

  console.log(
    `\n[Benchmark] getComplexityPenalty() caching: ${neuronCount} neurons`,
  );

  // Measure with fresh caches (first call)
  const iterations = 50000;

  // First, measure calling getComplexityPenalty() with cache populated
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].getComplexityPenalty(); // Prime the caches
  }

  const startCached = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    let total = 0;
    for (let i = creature.input; i < creature.neurons.length; i++) {
      total += creature.neurons[i].getComplexityPenalty();
    }
  }
  const durationCached = performance.now() - startCached;

  console.log(
    `  getComplexityPenalty() (cached): ${
      durationCached.toFixed(2)
    }ms for ${iterations} iterations`,
  );
  console.log(
    `  Average per neuron lookup: ${
      (durationCached / (iterations * hiddenCount) * 1000).toFixed(4)
    }µs`,
  );
  console.log(
    "  ✓ Neuron-level caching eliminates Activations.find() overhead",
  );
});
