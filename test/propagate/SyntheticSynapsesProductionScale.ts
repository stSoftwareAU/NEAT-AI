/**
 * SyntheticSynapsesProductionScale.ts — Validate synthetic synapse behaviour
 * with production-sized creatures.
 *
 * Issue #1924 — Tests that synthetic synapse generation, backpropagation,
 * and pruning work correctly at production scale (~1,000+ neurons,
 * ~18,000+ synapses) with the per-target cap preventing combinatorial
 * explosion.
 *
 * These are correctness tests only — timing is measured in bench/.
 */

import { assert, assertEquals, assertGreater, assertLess } from "@std/assert";
import { Creature } from "@creature";
import {
  DEFAULT_MAX_SYNTHETIC_PER_TARGET,
  generateSyntheticSynapses,
} from "@propagate/SyntheticSynapses.ts";
import { removeSyntheticSynapses } from "@propagate/RemoveSyntheticSynapses.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "./large/ProductionScaleCreature.ts";

// ---------------------------------------------------------------------------
// Test 1: Per-target cap limits synthetic synapse count at production scale
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: per-target cap limits count at production scale", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const originalSynapseCount = creature.synapses.length;
  assertGreater(originalSynapseCount, 18000);

  const result = generateSyntheticSynapses(creature);

  // With the cap, the total should be much less than the ~160,000
  // that uncapped full connectivity would produce.
  assertGreater(result.addedCount, 0, "Should add some synthetic synapses");
  assertLess(
    result.addedCount,
    80000,
    `Capped count should be well below uncapped ~160,000, got ${result.addedCount}`,
  );

  // Verify capping actually occurred (skippedCount > 0)
  assertGreater(
    result.skippedCount,
    0,
    "Should have skipped some potential connections due to cap",
  );

  // Verify tracking keys match added count
  assertEquals(
    result.syntheticKeys.size,
    result.addedCount,
    "Tracking keys should match added count",
  );

  // Creature should remain valid after adding synthetic synapses
  creature.validate();
});

// ---------------------------------------------------------------------------
// Test 2: Uncapped generation adds more synapses than capped
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: uncapped vs capped count comparison", () => {
  // Use a smaller creature to keep uncapped feasible
  const rng1 = createSeededRng(99);
  const json = generateProductionCreature(5, 2, rng1);

  // Capped run
  const creatureCapped = Creature.fromJSON(json);
  const cappedResult = generateSyntheticSynapses(creatureCapped);

  // Uncapped run (maxPerTarget set very high)
  const creatureUncapped = Creature.fromJSON(json);
  const uncappedResult = generateSyntheticSynapses(creatureUncapped, {
    maxPerTarget: Infinity,
  });

  // Uncapped should add more than capped
  assertGreater(
    uncappedResult.addedCount,
    cappedResult.addedCount,
    `Uncapped (${uncappedResult.addedCount}) should exceed capped (${cappedResult.addedCount})`,
  );

  // Capped should have skipped connections; uncapped should not
  assertGreater(cappedResult.skippedCount, 0);
  assertEquals(uncappedResult.skippedCount, 0);
});

// ---------------------------------------------------------------------------
// Test 3: Correctness roundtrip — outputs unchanged after generate + remove
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: creature outputs restored after generate and remove all", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  // Record outputs before synthetic synapse generation
  const testInputs = [
    new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9, -1]),
    new Float32Array([1, 0.5, 0, -0.5, -1, 0.3, -0.3, 0.8, -0.8, 0.1]),
    new Float32Array([
      -0.5,
      0.5,
      -0.5,
      0.5,
      -0.5,
      0.5,
      -0.5,
      0.5,
      -0.5,
      0.5,
    ]),
  ];

  const outputsBefore: Float32Array[] = [];
  for (const input of testInputs) {
    outputsBefore.push(new Float32Array(creature.activate(input)));
  }

  const originalSynapseCount = creature.synapses.length;

  // Generate synthetic synapses (all have weight = 0)
  const { syntheticKeys, addedCount } = generateSyntheticSynapses(creature);
  creature.clearState();
  assertGreater(syntheticKeys.size, 0);
  assertGreater(addedCount, 0);

  // Note: Zero-weight synapses may affect outputs for aggregate neurons
  // (MAXIMUM, MINIMUM) where the zero input changes the max/min result.
  // This is expected behaviour. The key correctness property is that
  // removing all synthetic synapses restores the original outputs.

  // Remove all synthetic synapses (use large threshold to remove everything)
  removeSyntheticSynapses(creature, syntheticKeys, Infinity);
  creature.clearState();

  // Synapse count should be restored to original
  assertEquals(
    creature.synapses.length,
    originalSynapseCount,
    `Synapse count should be restored: original=${originalSynapseCount}, ` +
      `after removal=${creature.synapses.length}`,
  );

  // Outputs should be identical after removal (roundtrip correctness)
  for (let i = 0; i < testInputs.length; i++) {
    const outputAfter = creature.activate(testInputs[i]);
    for (let j = 0; j < outputAfter.length; j++) {
      assertEquals(
        outputAfter[j],
        outputsBefore[i][j],
        `Output[${j}] should be restored after removing all synthetics: ` +
          `before=${outputsBefore[i][j]}, after=${outputAfter[j]}`,
      );
    }
  }

  // Creature should remain valid
  creature.validate();
});

// ---------------------------------------------------------------------------
// Test 4: Full training lifecycle with synthetic synapses at production scale
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: full training lifecycle at production scale", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const dataRng = createSeededRng(789);
  const trainingData = generateTrainingData(10, 3, 30, dataRng);

  // Train with synthetic synapses enabled (1 iteration to keep fast)
  const results = train(creature, trainingData, {
    targetError: 0.01,
    iterations: 1,
    learningRate: 0.1,
    disableRandomSamples: true,
    generations: 0,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    normaliseGradients: true,
    sparseRatio: 1,
    syntheticSynapses: true,
  });

  // Creature should be valid after training with synthetic synapses
  creature.validate();

  // Error should be finite
  assert(
    Number.isFinite(results.error),
    `Training error should be finite, got ${results.error}`,
  );

  // All weights and biases should be finite
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight must be finite, got ${synapse.weight}`,
    );
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input" && neuron.type !== "constant") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias must be finite, got ${neuron.bias}`,
      );
    }
  }

  // Activations should produce finite output
  for (const sample of trainingData.slice(0, 3)) {
    const output = creature.activate(new Float32Array(sample.input));
    for (let j = 0; j < output.length; j++) {
      assert(
        Number.isFinite(output[j]),
        `Output must be finite after training, got ${output[j]}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Test 5: Synthetic synapses at production scale are deterministic
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: generation is deterministic at production scale", () => {
  const rng1 = createSeededRng(42);
  const json1 = generateProductionCreature(10, 3, rng1);
  const creature1 = Creature.fromJSON(json1);

  const rng2 = createSeededRng(42);
  const json2 = generateProductionCreature(10, 3, rng2);
  const creature2 = Creature.fromJSON(json2);

  const result1 = generateSyntheticSynapses(creature1);
  const result2 = generateSyntheticSynapses(creature2);

  assertEquals(
    result1.addedCount,
    result2.addedCount,
    "Same creature should produce same synthetic synapse count",
  );
  assertEquals(
    result1.skippedCount,
    result2.skippedCount,
    "Same creature should produce same skipped count",
  );

  // Verify the exact same keys were generated
  for (const key of result1.syntheticKeys) {
    assert(
      result2.syntheticKeys.has(key),
      `Key ${key} from run 1 should exist in run 2`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 6: Custom maxPerTarget is respected
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: custom maxPerTarget limits connections", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);

  // Very low cap
  const creatureLow = Creature.fromJSON(json);
  const lowResult = generateSyntheticSynapses(creatureLow, {
    maxPerTarget: 10,
  });

  // Default cap
  const creatureDefault = Creature.fromJSON(json);
  const defaultResult = generateSyntheticSynapses(creatureDefault);

  // Lower cap should produce fewer connections
  assertLess(
    lowResult.addedCount,
    defaultResult.addedCount,
    `maxPerTarget=10 (${lowResult.addedCount}) should add fewer than ` +
      `default=${DEFAULT_MAX_SYNTHETIC_PER_TARGET} (${defaultResult.addedCount})`,
  );

  // Both creatures should validate
  creatureLow.validate();
  creatureDefault.validate();
});

// ---------------------------------------------------------------------------
// Test 7: Memory estimate — document additional memory usage
// ---------------------------------------------------------------------------

Deno.test("synthetic synapses: memory estimate at production scale", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const originalSynapseCount = creature.synapses.length;
  const result = generateSyntheticSynapses(creature);

  // Estimate memory: each synapse object has from (8), to (8), weight (8),
  // plus object overhead (~64 bytes). Plus the tracking key string (~20 bytes).
  const estimatedBytesPerSynapse = 88;
  const estimatedAdditionalMB = (result.addedCount * estimatedBytesPerSynapse) /
    (1024 * 1024);

  console.log(
    `Synthetic synapse memory estimate:`,
    `\n  Original synapses: ${originalSynapseCount}`,
    `\n  Synthetic added: ${result.addedCount}`,
    `\n  Skipped (capped): ${result.skippedCount}`,
    `\n  Total synapses: ${creature.synapses.length}`,
    `\n  Expansion ratio: ${
      (creature.synapses.length / originalSynapseCount).toFixed(1)
    }x`,
    `\n  Estimated additional memory: ${estimatedAdditionalMB.toFixed(1)} MB`,
    `\n  Max per target: ${DEFAULT_MAX_SYNTHETIC_PER_TARGET}`,
  );

  // Memory should be reasonable (under 50 MB for synapse objects)
  assertLess(
    estimatedAdditionalMB,
    50,
    `Additional memory should be under 50 MB, estimated ${
      estimatedAdditionalMB.toFixed(1)
    } MB`,
  );

  // Expansion ratio should be reasonable (under 5x)
  const expansionRatio = creature.synapses.length / originalSynapseCount;
  assertLess(
    expansionRatio,
    5,
    `Expansion ratio should be under 5x, got ${expansionRatio.toFixed(1)}x`,
  );
});
