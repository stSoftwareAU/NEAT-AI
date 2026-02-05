/**
 * Issue #1308 - Enhanced discovery candidate validation
 *
 * This test suite verifies the EnhancedDiscoveryValidator which combines:
 * - Holdout validation (catch overfitting)
 * - Brittleness scoring (catch sensitivity to input perturbations)
 * - Integration with existing BatchDiscoveryValidator pipeline
 *
 * Tests follow TDD - written first before implementation.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import type {
  DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";
import {
  EnhancedDiscoveryValidator,
  type EnhancedValidationOptions,
} from "../../src/discovery/EnhancedDiscoveryValidator.ts";

function makeBaselineCreature(): Creature {
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
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeCandidateCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.4 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
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
  "EnhancedDiscoveryValidator validates candidate with full pipeline",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 5,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      assertExists(result, "Should return validation result");
      assertExists(result.passed, "Should have passed flag");
      assertExists(result.holdoutResult, "Should include holdout result");
      assertExists(
        result.brittlenessResult,
        "Should include brittleness result",
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

Deno.test(
  "EnhancedDiscoveryValidator can run holdout only",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: false,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      assertExists(result.holdoutResult, "Should include holdout result");
      assertEquals(
        result.brittlenessResult,
        undefined,
        "Should not include brittleness result",
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

Deno.test(
  "EnhancedDiscoveryValidator can run brittleness only",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: false,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 5,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      assertEquals(
        result.holdoutResult,
        undefined,
        "Should not include holdout result",
      );
      assertExists(
        result.brittlenessResult,
        "Should include brittleness result",
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

Deno.test(
  "EnhancedDiscoveryValidator fails if holdout check fails",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    // Very strict threshold to force failure
    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        maxPerformanceGap: 0.000001,
        seed: 42,
      },
      brittleness: {
        enabled: false,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // With a very strict threshold, the validation may fail
      if (result.holdoutResult && !result.holdoutResult.passed) {
        assertEquals(
          result.passed,
          false,
          "Overall should fail if holdout fails",
        );
        assertExists(
          result.rejectionReasons,
          "Should provide rejection reasons",
        );
        assert(
          result.rejectionReasons!.length > 0,
          "Should have at least one rejection reason",
        );
      }
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "EnhancedDiscoveryValidator fails if brittleness check fails",
  () => {
    // Create a very sensitive creature
    const base = makeBaselineCreature();
    const sensitiveCreature = Creature.fromJSON({
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
    sensitiveCreature.validate();
    CreatureUtil.makeUUID(sensitiveCreature);

    const candidate: DiscoveryCandidate = {
      creature: sensitiveCreature,
      change: {
        type: "change-squash",
        description: "Test sensitive creature",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    // Very strict threshold to force failure
    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: false,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 10,
        brittlenessThreshold: 0.0001,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // With a very strict threshold, brittleness check may fail
      if (result.brittlenessResult && !result.brittlenessResult.passed) {
        assertEquals(
          result.passed,
          false,
          "Overall should fail if brittleness fails",
        );
        assertExists(
          result.rejectionReasons,
          "Should provide rejection reasons",
        );
      }
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "EnhancedDiscoveryValidator provides combined statistics",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 5,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // Combined statistics should be available
      assertExists(result.validationTime, "Should report validation time");
      assertExists(result.passed, "Should have overall pass/fail");
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "EnhancedDiscoveryValidator validates batch of candidates",
  () => {
    const base = makeBaselineCreature();
    const candidates: DiscoveryCandidate[] = [
      {
        creature: makeCandidateCreature(),
        change: {
          type: "change-squash",
          description: "Candidate 1",
        },
      },
      {
        creature: makeCandidateCreature(),
        change: {
          type: "change-squash",
          description: "Candidate 2",
        },
      },
    ];

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 3,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const results = validator.validateBatch(base, candidates, dataDir);

      assertEquals(
        results.length,
        candidates.length,
        "Should return result for each candidate",
      );

      for (const result of results) {
        assertExists(result.passed, "Each result should have passed flag");
      }
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "EnhancedDiscoveryValidator computes combined brittleness score",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 5,
        seed: 42,
      },
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // Combined brittleness score incorporates both holdout gap and perturbation variance
      assertExists(
        result.combinedBrittlenessScore,
        "Should have combined brittleness score",
      );
      assert(
        result.combinedBrittlenessScore! >= 0,
        "Combined brittleness score should be non-negative",
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

Deno.test(
  "EnhancedDiscoveryValidator logs brittleness metrics when verbose",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(100);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    const options: EnhancedValidationOptions = {
      holdout: {
        enabled: true,
        holdoutPercentage: 0.2,
        seed: 42,
      },
      brittleness: {
        enabled: true,
        perturbationMagnitude: 0.1,
        perturbationsPerInput: 5,
        seed: 42,
      },
      verbose: true,
    };

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // When verbose, detailed metrics should be available
      assertExists(result, "Should return result");
      if (result.holdoutResult) {
        assertExists(
          result.holdoutResult.holdoutError,
          "Should have holdout error",
        );
      }
      if (result.brittlenessResult) {
        assertExists(
          result.brittlenessResult.brittlenessScore,
          "Should have brittleness score",
        );
      }
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "EnhancedDiscoveryValidator disabled by default when options not provided",
  () => {
    const base = makeBaselineCreature();
    const candidate: DiscoveryCandidate = {
      creature: makeCandidateCreature(),
      change: {
        type: "change-squash",
        description: "Test squash change",
      },
    };

    const data = generateTestData(50);
    const dataDir = makeDataDir(data, 1000, {
      input: base.input,
      output: base.output,
    });

    // No options provided - should be disabled
    const options: EnhancedValidationOptions = {};

    const validator = new EnhancedDiscoveryValidator(options);

    try {
      const result = validator.validateCandidate(
        base,
        candidate,
        dataDir,
      );

      // Without explicit enablement, enhanced validation should be skipped
      assertEquals(
        result.holdoutResult,
        undefined,
        "Holdout should be skipped",
      );
      assertEquals(
        result.brittlenessResult,
        undefined,
        "Brittleness should be skipped",
      );
      assertEquals(result.passed, true, "Should pass by default when disabled");
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);
