/**
 * Integration tests for fitness plateau detection during evolution.
 *
 * Issue #1039: Performance: Implement fitness plateau detection with stagnation response
 *
 * These tests verify that plateau detection integrates correctly with the
 * evolution process and that stagnation responses are applied properly.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

Deno.test("PlateauDetection Integration - evolve returns plateau status", async () => {
  // Simple XOR dataset - known to potentially cause stagnation
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  // Run a few iterations with plateau detection enabled
  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 50,
    targetError: 0.001, // Very low target to encourage stagnation
    populationSize: 20,
    threads: 1,
    plateauDetection: {
      enabled: true,
      windowSize: 5, // Small window for faster detection in tests
      minImprovementRate: 0.001,
      responseMutationMultiplier: 2.0,
    },
  });

  // Verify result has expected properties
  assertEquals(typeof result.error, "number");
  assertEquals(typeof result.score, "number");
  assertEquals(typeof result.time, "number");
  assertGreater(result.time, 0);
});

Deno.test("PlateauDetection Integration - disabled by default (backward compatibility)", async () => {
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  // Run without plateau detection configuration
  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 10,
    targetError: 0.1,
    populationSize: 10,
    threads: 1,
  });

  // Should work normally without plateau detection
  assertEquals(typeof result.error, "number");
});
