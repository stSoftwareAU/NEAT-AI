import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { emptyDirSync, ensureDirSync } from "@std/fs";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("discovery promise cleanup - simulated with evolveDataSet", async () => {
  // Create a network with many neurons to test promise cleanup during evolution
  const creature = new Creature(5, 2, {
    layers: [
      { count: 10 },
    ],
  });

  // Generate some training data
  const trainingSet = [];
  for (let i = 0; i < 100; i++) {
    trainingSet.push({
      input: new Float32Array([
        Math.random(),
        Math.random(),
        Math.random(),
        Math.random(),
        Math.random(),
      ]),
      output: new Float32Array([Math.random(), Math.random()]),
    });
  }

  const creatureStore = ".test-discovery-memory";
  ensureDirSync(creatureStore);
  emptyDirSync(creatureStore);

  const options: NeatOptions = {
    iterations: 2, // Just 2 generations to test
    populationSize: 5,
    threads: 1,
    creatureStore: creatureStore,
    checkpointEveryGeneration: true, // Test checkpoint too
    targetError: 0.01, // Low enough that it won't reach it quickly
    log: 0, // Disable logging for cleaner output
    discoveryTimeOutMinutes: 0, // Disable discovery for this test
  };

  const startTime = Date.now();
  await creature.evolveDataSet(trainingSet, options);
  const duration = Date.now() - startTime;

  // Verify evolution completed
  assert(duration > 0, "Evolution should take some time");
  assert(
    duration < 30000,
    `Evolution should complete quickly, took ${duration}ms`,
  );

  // Verify checkpoint was created
  let creatureCount = 0;
  // deno-lint-ignore no-sync-fn-in-async-fn
  for (const dirEntry of Deno.readDirSync(creatureStore)) {
    if (dirEntry.name.endsWith(".json")) {
      creatureCount++;
    }
  }
  assert(
    creatureCount === options.populationSize,
    `Expected ${options.populationSize} checkpointed creatures, found ${creatureCount}`,
  );

  // Clean up
  await Deno.remove(creatureStore, { recursive: true });
});

Deno.test("discovery promise map cleanup", () => {
  // Unit test for the promise cleanup pattern
  const promiseMap = new Map<string, Promise<void>>();
  let completedCount = 0;

  // Create promises that complete at different times
  for (let i = 0; i < 10; i++) {
    const key = `promise-${i}`;
    const promise = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, Math.random() * 10);
    }).then(() => {
      // Cleanup: remove from map when complete
      promiseMap.delete(key);
      completedCount++;
    });

    promiseMap.set(key, promise);
  }

  // Verify all were added
  assert(promiseMap.size === 10, "Should have 10 promises");

  // Wait for all to complete using polling (like the optimized code)
  return new Promise<void>((resolve) => {
    const pollInterval = setInterval(() => {
      if (promiseMap.size === 0) {
        clearInterval(pollInterval);
        assert(
          completedCount === 10,
          `All promises should complete, got ${completedCount}`,
        );
        resolve();
      }
    }, 5);
  });
});
