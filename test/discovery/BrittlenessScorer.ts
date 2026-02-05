/**
 * Issue #1308 - Brittleness scoring for discovery candidates
 *
 * This test suite verifies the BrittlenessScorer which computes a brittleness
 * metric for discovery candidates by testing with perturbed inputs.
 *
 * A brittle candidate shows high variance in outputs when inputs are slightly
 * perturbed, indicating sensitivity to input distributions not in the test set.
 *
 * Tests follow TDD - written first before implementation.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  BrittlenessScorer,
  type BrittlenessScorerOptions,
  perturbInput,
} from "../../src/discovery/BrittlenessScorer.ts";

function makeSimpleCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
    ],
  });
  creature.validate();
  return creature;
}

function makeSensitiveCreature(): Creature {
  // A creature with high weights will amplify small input changes
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 10.0 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 10.0 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 10.0 },
    ],
  });
  creature.validate();
  return creature;
}

Deno.test(
  "perturbInput adds small perturbations within specified magnitude",
  () => {
    const input = new Float32Array([0.5, 0.5]);
    const magnitude = 0.1;
    const seed = 42;

    const perturbed = perturbInput(input, magnitude, seed);

    assertEquals(perturbed.length, input.length, "Length should match");

    // Each perturbed value should be within magnitude of original
    for (let i = 0; i < input.length; i++) {
      const diff = Math.abs(perturbed[i] - input[i]);
      assert(
        diff <= magnitude,
        `Perturbation ${diff} should be <= ${magnitude}`,
      );
    }
  },
);

Deno.test(
  "perturbInput with same seed produces same perturbation",
  () => {
    const input = new Float32Array([0.5, 0.5]);
    const magnitude = 0.1;
    const seed = 42;

    const perturbed1 = perturbInput(input, magnitude, seed);
    const perturbed2 = perturbInput(input, magnitude, seed);

    for (let i = 0; i < input.length; i++) {
      assertEquals(
        perturbed1[i],
        perturbed2[i],
        "Same seed should produce same perturbation",
      );
    }
  },
);

Deno.test(
  "perturbInput with different seeds produces different perturbations",
  () => {
    const input = new Float32Array([0.5, 0.5]);
    const magnitude = 0.1;

    const perturbed1 = perturbInput(input, magnitude, 42);
    const perturbed2 = perturbInput(input, magnitude, 123);

    let allSame = true;
    for (let i = 0; i < input.length; i++) {
      if (perturbed1[i] !== perturbed2[i]) {
        allSame = false;
        break;
      }
    }

    assert(!allSame, "Different seeds should produce different perturbations");
  },
);

Deno.test(
  "BrittlenessScorer computes brittleness score for candidate",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
      new Float32Array([0.5, 0.6]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(creature, inputs);

    assertExists(result, "Should return brittleness result");
    assertExists(result.brittlenessScore, "Should have brittleness score");
    assert(
      Number.isFinite(result.brittlenessScore),
      "Score should be finite",
    );
    assert(
      result.brittlenessScore >= 0,
      "Score should be non-negative",
    );
  },
);

Deno.test(
  "BrittlenessScorer reports variance across perturbations",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 10,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(creature, inputs);

    assertExists(result.outputVariance, "Should report output variance");
    assertExists(
      result.maxOutputChange,
      "Should report max output change",
    );
    assertExists(
      result.meanOutputChange,
      "Should report mean output change",
    );
  },
);

Deno.test(
  "BrittlenessScorer detects sensitive creatures as more brittle",
  () => {
    const stableCreature = makeSimpleCreature();
    const sensitiveCreature = makeSensitiveCreature();

    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
      new Float32Array([0.5, 0.6]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.05,
      perturbationsPerInput: 10,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const stableResult = scorer.computeBrittleness(stableCreature, inputs);
    const sensitiveResult = scorer.computeBrittleness(
      sensitiveCreature,
      inputs,
    );

    // Sensitive creature with high weights should show more brittleness
    assert(
      sensitiveResult.brittlenessScore >= stableResult.brittlenessScore,
      `Sensitive creature (${sensitiveResult.brittlenessScore}) should be >= stable (${stableResult.brittlenessScore})`,
    );
  },
);

Deno.test(
  "BrittlenessScorer respects configurable threshold",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ];

    // Very low threshold - likely to reject
    const strictOptions: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      brittlenessThreshold: 0.001,
      seed: 42,
    };

    // Very high threshold - likely to pass
    const lenientOptions: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      brittlenessThreshold: 100,
      seed: 42,
    };

    const strictScorer = new BrittlenessScorer(strictOptions);
    const lenientScorer = new BrittlenessScorer(lenientOptions);

    const strictResult = strictScorer.computeBrittleness(creature, inputs);
    const lenientResult = lenientScorer.computeBrittleness(creature, inputs);

    // Same brittleness score, different pass/fail outcomes
    assertEquals(
      strictResult.brittlenessScore,
      lenientResult.brittlenessScore,
      "Scores should be identical with same seed",
    );

    if (strictResult.brittlenessScore > 0.001) {
      assertEquals(strictResult.passed, false, "Should fail strict threshold");
    }
    assertEquals(lenientResult.passed, true, "Should pass lenient threshold");
  },
);

Deno.test(
  "BrittlenessScorer tests across input ranges",
  () => {
    const creature = makeSimpleCreature();

    // Test inputs across different ranges
    const inputs = [
      new Float32Array([0.0, 0.0]),
      new Float32Array([0.5, 0.5]),
      new Float32Array([1.0, 1.0]),
      new Float32Array([-0.5, 0.5]),
      new Float32Array([0.5, -0.5]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(creature, inputs);

    assertExists(result.testedInputCount, "Should report tested input count");
    assertEquals(
      result.testedInputCount,
      inputs.length,
      "Should test all provided inputs",
    );
  },
);

Deno.test(
  "BrittlenessScorer handles single input gracefully",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [new Float32Array([0.5, 0.5])];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(creature, inputs);

    assertExists(result, "Should handle single input");
    assertExists(result.brittlenessScore, "Should have brittleness score");
    assert(
      Number.isFinite(result.brittlenessScore),
      "Score should be finite",
    );
  },
);

Deno.test(
  "BrittlenessScorer provides rejection reason when threshold exceeded",
  () => {
    const sensitiveCreature = makeSensitiveCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ];

    // Very low threshold to trigger rejection
    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 10,
      brittlenessThreshold: 0.0001,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(sensitiveCreature, inputs);

    if (!result.passed) {
      assertExists(
        result.rejectionReason,
        "Should provide rejection reason when failed",
      );
      assert(
        result.rejectionReason!.toLowerCase().includes("brittleness"),
        "Rejection reason should mention brittleness",
      );
    }
  },
);

Deno.test(
  "BrittlenessScorer provides statistics for analysis logging",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
      new Float32Array([0.5, 0.6]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      seed: 42,
    };

    const scorer = new BrittlenessScorer(options);
    const result = scorer.computeBrittleness(creature, inputs);

    // Should provide enough statistics for logging/analysis
    assertExists(result.brittlenessScore, "Should have brittleness score");
    assertExists(result.outputVariance, "Should have output variance");
    assertExists(result.maxOutputChange, "Should have max output change");
    assertExists(result.meanOutputChange, "Should have mean output change");
    assertExists(result.testedInputCount, "Should have tested input count");
    assertExists(
      result.totalPerturbations,
      "Should have total perturbation count",
    );
  },
);

Deno.test(
  "BrittlenessScorer deterministic with same seed",
  () => {
    const creature = makeSimpleCreature();
    const inputs = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ];

    const options: BrittlenessScorerOptions = {
      perturbationMagnitude: 0.1,
      perturbationsPerInput: 5,
      seed: 42,
    };

    const scorer1 = new BrittlenessScorer(options);
    const scorer2 = new BrittlenessScorer(options);

    const result1 = scorer1.computeBrittleness(creature, inputs);
    const result2 = scorer2.computeBrittleness(creature, inputs);

    assertEquals(
      result1.brittlenessScore,
      result2.brittlenessScore,
      "Same seed should produce same brittleness score",
    );
    assertEquals(
      result1.outputVariance,
      result2.outputVariance,
      "Same seed should produce same variance",
    );
  },
);
