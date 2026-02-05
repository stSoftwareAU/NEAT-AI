/**
 * Issue #1308 - Enhanced discovery candidate validation with holdout testing
 *
 * This test suite verifies the HoldoutValidator which validates discovery candidates
 * against a holdout dataset to catch overfitting and brittleness before integration.
 *
 * Tests follow TDD - written first before implementation.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import {
  HoldoutValidator,
  type HoldoutValidatorOptions,
  splitDataForHoldout,
} from "../../src/discovery/HoldoutValidator.ts";

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

function generateTestData(
  count: number,
): Array<{ input: Float32Array; output: Float32Array }> {
  const data: Array<{ input: Float32Array; output: Float32Array }> = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random();
    const b = Math.random();
    data.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a + b]),
    });
  }
  return data;
}

Deno.test(
  "splitDataForHoldout correctly splits data by percentage",
  () => {
    const data = generateTestData(100);
    const holdoutPercentage = 0.2;

    const { training, holdout } = splitDataForHoldout(data, holdoutPercentage);

    assertEquals(holdout.length, 20, "Holdout should have 20% of data");
    assertEquals(training.length, 80, "Training should have 80% of data");
    assertEquals(
      training.length + holdout.length,
      data.length,
      "Combined should equal original",
    );
  },
);

Deno.test(
  "splitDataForHoldout uses deterministic seed for reproducibility",
  () => {
    const data = generateTestData(100);
    const holdoutPercentage = 0.2;
    const seed = 42;

    const split1 = splitDataForHoldout(data, holdoutPercentage, seed);
    const split2 = splitDataForHoldout(data, holdoutPercentage, seed);

    // Same seed should produce same split
    assertEquals(
      split1.holdout.length,
      split2.holdout.length,
      "Same seed should produce same holdout size",
    );

    // Verify the actual indices match
    const holdout1Inputs = split1.holdout.map((d) =>
      Array.from(d.input).join(",")
    );
    const holdout2Inputs = split2.holdout.map((d) =>
      Array.from(d.input).join(",")
    );
    assertEquals(
      holdout1Inputs,
      holdout2Inputs,
      "Same seed should produce identical holdout samples",
    );
  },
);

Deno.test(
  "splitDataForHoldout with different seeds produces different splits",
  () => {
    const data = generateTestData(100);
    const holdoutPercentage = 0.2;

    const split1 = splitDataForHoldout(data, holdoutPercentage, 42);
    const split2 = splitDataForHoldout(data, holdoutPercentage, 123);

    const holdout1Set = new Set(
      split1.holdout.map((d) => Array.from(d.input).join(",")),
    );
    const holdout2Set = new Set(
      split2.holdout.map((d) => Array.from(d.input).join(",")),
    );

    // Different seeds should produce different sets (with high probability)
    let matchCount = 0;
    for (const item of holdout1Set) {
      if (holdout2Set.has(item)) matchCount++;
    }

    // Allow some overlap but not complete match
    assert(
      matchCount < holdout1Set.size,
      "Different seeds should produce different splits",
    );
  },
);

Deno.test(
  "HoldoutValidator validates candidate against holdout data",
  () => {
    const creature = makeSimpleCreature();
    const data = generateTestData(50);

    const options: HoldoutValidatorOptions = {
      holdoutPercentage: 0.2,
      seed: 42,
    };

    const validator = new HoldoutValidator(options);

    // Create a data directory for the holdout
    const { holdout } = splitDataForHoldout(
      data,
      options.holdoutPercentage ?? 0.2,
      options.seed,
    );
    const dataDir = makeDataDir(holdout, 1000, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const result = validator.validateCandidate(creature, dataDir);

      assertExists(result, "Should return validation result");
      assertExists(result.holdoutError, "Should have holdout error");
      assert(
        Number.isFinite(result.holdoutError),
        "Holdout error should be finite",
      );
    } finally {
      // Clean up
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "HoldoutValidator computes performance gap between discovery and holdout",
  () => {
    const creature = makeSimpleCreature();
    const data = generateTestData(100);

    const options: HoldoutValidatorOptions = {
      holdoutPercentage: 0.2,
      seed: 42,
    };

    const validator = new HoldoutValidator(options);
    const { training, holdout } = splitDataForHoldout(
      data,
      options.holdoutPercentage ?? 0.2,
      options.seed,
    );

    // Create data directories
    const trainingDir = makeDataDir(training, 1000, {
      input: creature.input,
      output: creature.output,
    });
    const holdoutDir = makeDataDir(holdout, 1000, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const result = validator.validateWithGap(
        creature,
        trainingDir,
        holdoutDir,
      );

      assertExists(result, "Should return validation result");
      assertExists(result.trainingError, "Should have training error");
      assertExists(result.holdoutError, "Should have holdout error");
      assertExists(result.performanceGap, "Should have performance gap");

      // Performance gap is holdout - training (positive means overfitting)
      assertEquals(
        result.performanceGap,
        result.holdoutError - result.trainingError!,
        "Performance gap should be holdout - training",
      );
    } finally {
      // Clean up
      try {
        Deno.removeSync(trainingDir, { recursive: true });
        Deno.removeSync(holdoutDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "HoldoutValidator rejects candidates exceeding performance gap threshold",
  () => {
    const creature = makeSimpleCreature();
    const data = generateTestData(100);

    const options: HoldoutValidatorOptions = {
      holdoutPercentage: 0.2,
      seed: 42,
      // Very low threshold to trigger rejection
      maxPerformanceGap: 0.001,
    };

    const validator = new HoldoutValidator(options);
    const { training, holdout } = splitDataForHoldout(
      data,
      options.holdoutPercentage ?? 0.2,
      options.seed,
    );

    // Create data directories
    const trainingDir = makeDataDir(training, 1000, {
      input: creature.input,
      output: creature.output,
    });
    const holdoutDir = makeDataDir(holdout, 1000, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const result = validator.validateWithGap(
        creature,
        trainingDir,
        holdoutDir,
      );

      assertExists(result, "Should return validation result");
      // With a very low threshold, the candidate is likely to be rejected
      // unless the creature happens to generalise perfectly
      if (
        Math.abs(result.performanceGap ?? 0) >
          (options.maxPerformanceGap ?? 0.001)
      ) {
        assertEquals(
          result.passed,
          false,
          "Should reject candidate exceeding gap threshold",
        );
        assertExists(
          result.rejectionReason,
          "Should provide rejection reason",
        );
      }
    } finally {
      // Clean up
      try {
        Deno.removeSync(trainingDir, { recursive: true });
        Deno.removeSync(holdoutDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "HoldoutValidator respects configurable holdout percentage",
  () => {
    const data = generateTestData(100);

    // Test various percentages
    const percentages = [0.1, 0.2, 0.3, 0.5];

    for (const pct of percentages) {
      const { training, holdout } = splitDataForHoldout(data, pct);

      const expectedHoldout = Math.round(data.length * pct);
      const expectedTraining = data.length - expectedHoldout;

      assertEquals(
        holdout.length,
        expectedHoldout,
        `Holdout should be ${pct * 100}% of data (${expectedHoldout})`,
      );
      assertEquals(
        training.length,
        expectedTraining,
        `Training should be ${(1 - pct) * 100}% of data (${expectedTraining})`,
      );
    }
  },
);

Deno.test(
  "HoldoutValidator handles edge case of minimum data",
  () => {
    // Very small dataset
    const data = generateTestData(5);
    const holdoutPercentage = 0.2;

    const { training, holdout } = splitDataForHoldout(data, holdoutPercentage);

    // With 5 items at 20%, we should get 1 holdout and 4 training
    assertEquals(holdout.length, 1, "Should have at least 1 holdout sample");
    assertEquals(training.length, 4, "Remaining should be training");
  },
);

Deno.test(
  "HoldoutValidator returns statistics for logging",
  () => {
    const creature = makeSimpleCreature();
    const data = generateTestData(50);

    const options: HoldoutValidatorOptions = {
      holdoutPercentage: 0.2,
      seed: 42,
    };

    const validator = new HoldoutValidator(options);
    const { holdout } = splitDataForHoldout(
      data,
      options.holdoutPercentage ?? 0.2,
      options.seed,
    );

    const dataDir = makeDataDir(holdout, 1000, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const result = validator.validateCandidate(creature, dataDir);

      assertExists(
        result.holdoutSampleCount,
        "Should report holdout sample count",
      );
      assertEquals(
        result.holdoutSampleCount,
        holdout.length,
        "Holdout sample count should match",
      );
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);
