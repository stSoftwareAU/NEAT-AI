/**
 * Tests for adaptive mutation rate based on fitness progress.
 *
 * Issue #1012: Performance: Implement adaptive mutation rate based on fitness progress
 *
 * The adaptive mutation rate feature adjusts mutation rate based on whether
 * evolution is improving, stagnating, or stable:
 *
 * - During fitness plateau/stagnation: Higher mutation rate to explore
 * - During rapid improvement: Lower mutation rate to exploit good solutions
 * - During stable progress: Normal mutation rate
 *
 * This complements the existing features:
 * - Issue #1037: Adaptive mutation based on creature size
 * - Issue #1039: Plateau detection with stagnation response
 *
 * Issue #1012 extends #1039 to also reduce mutation rate during improvement.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  PlateauDetector,
} from "../../src/NEAT/PlateauDetector.ts";

// ============================================================================
// Configuration Tests for Improvement-Based Mutation Rate Reduction
// ============================================================================

Deno.test(
  "AdaptiveMutationFitnessProgress: config has responseImprovementMultiplier with default 0.8",
  () => {
    const config = createNeatConfig({
      plateauDetection: {
        enabled: true,
      },
    });

    // New config field for improvement-based mutation rate reduction
    assertEquals(
      config.plateauDetection.responseImprovementMultiplier,
      0.8,
      "Default responseImprovementMultiplier should be 0.8 (20% reduction)",
    );
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: config has rapidImprovementRate with default 0.01",
  () => {
    const config = createNeatConfig({
      plateauDetection: {
        enabled: true,
      },
    });

    // Threshold for detecting rapid improvement
    assertEquals(
      config.plateauDetection.rapidImprovementRate,
      0.01,
      "Default rapidImprovementRate should be 0.01 (1% improvement over window)",
    );
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: config accepts custom improvement settings",
  () => {
    const config = createNeatConfig({
      plateauDetection: {
        enabled: true,
        responseImprovementMultiplier: 0.5,
        rapidImprovementRate: 0.02,
      },
    });

    assertEquals(config.plateauDetection.responseImprovementMultiplier, 0.5);
    assertEquals(config.plateauDetection.rapidImprovementRate, 0.02);
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: validation - responseImprovementMultiplier must be between 0 and 1",
  () => {
    // Should reject values > 1
    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            responseImprovementMultiplier: 1.5,
          },
        });
      },
      Error,
      "responseImprovementMultiplier",
    );

    // Should reject negative values
    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            responseImprovementMultiplier: -0.1,
          },
        });
      },
      Error,
      "responseImprovementMultiplier",
    );
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: validation - responseImprovementMultiplier allows boundary values",
  () => {
    // 0 should be valid (completely disable mutations during improvement - extreme)
    const configZero = createNeatConfig({
      plateauDetection: {
        responseImprovementMultiplier: 0,
      },
    });
    assertEquals(configZero.plateauDetection.responseImprovementMultiplier, 0);

    // 1 should be valid (no change during improvement)
    const configOne = createNeatConfig({
      plateauDetection: {
        responseImprovementMultiplier: 1,
      },
    });
    assertEquals(configOne.plateauDetection.responseImprovementMultiplier, 1);
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: validation - rapidImprovementRate must be between 0 and 1",
  () => {
    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            rapidImprovementRate: -0.01,
          },
        });
      },
      Error,
      "rapidImprovementRate",
    );

    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            rapidImprovementRate: 1.5,
          },
        });
      },
      Error,
      "rapidImprovementRate",
    );
  },
);

Deno.test(
  "AdaptiveMutationFitnessProgress: validation - rapidImprovementRate must be greater than minImprovementRate",
  () => {
    // rapidImprovementRate should be greater than minImprovementRate
    // Otherwise the "stable" zone would not exist
    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            minImprovementRate: 0.01,
            rapidImprovementRate: 0.005, // Less than minImprovementRate
          },
        });
      },
      Error,
      "rapidImprovementRate",
    );

    // Equal values should also be rejected (no stable zone)
    assertThrows(
      () => {
        createNeatConfig({
          plateauDetection: {
            minImprovementRate: 0.01,
            rapidImprovementRate: 0.01,
          },
        });
      },
      Error,
      "rapidImprovementRate",
    );
  },
);

// ============================================================================
// PlateauDetector - Improvement Detection Tests
// ============================================================================

Deno.test("PlateauDetector: isImproving returns false when insufficient history", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 10,
    rapidImprovementRate: 0.01,
    enabled: true,
  });

  // Add fewer samples than window size
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-0.5 + i * 0.1);
  }

  assertEquals(detector.isImproving(), false);
});

Deno.test("PlateauDetector: isImproving returns true during rapid improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001, // 0.1% minimum
    rapidImprovementRate: 0.01, // 1% for rapid
    responseImprovementMultiplier: 0.8,
    enabled: true,
  });

  // Add rapidly improving fitness values
  // Start: -1.0, End: -0.9 -> improvement = 0.1, rate = 0.1/1.0 = 10%
  // This is well above the 1% threshold
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-1.0 + i * 0.05); // 5% per generation
  }

  assertEquals(detector.isImproving(), true);
});

Deno.test("PlateauDetector: isImproving returns false during slow improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001, // 0.1% minimum (not stagnating)
    rapidImprovementRate: 0.01, // 1% for rapid
    responseImprovementMultiplier: 0.8,
    enabled: true,
  });

  // Add slowly improving fitness - above stagnation but below rapid improvement
  // 0.5% improvement over window (between 0.1% and 1%)
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-1.0 + i * 0.001); // 0.1% per generation = 0.5% over window
  }

  assertEquals(detector.isImproving(), false);
  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector: isImproving returns false when disabled", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    rapidImprovementRate: 0.01,
    responseImprovementMultiplier: 0.8,
    enabled: false,
  });

  // Add rapidly improving fitness
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-1.0 + i * 0.1);
  }

  // Should return false because detector is disabled
  assertEquals(detector.isImproving(), false);
});

// ============================================================================
// PlateauDetector - getMutationMultiplier with Improvement Reduction
// ============================================================================

Deno.test(
  "PlateauDetector: getMutationMultiplier returns < 1 during rapid improvement",
  () => {
    const detector = new PlateauDetector({
      ...DEFAULT_PLATEAU_DETECTION,
      windowSize: 5,
      minImprovementRate: 0.001,
      rapidImprovementRate: 0.01,
      responseMutationMultiplier: 2.0,
      responseImprovementMultiplier: 0.8,
      enabled: true,
    });

    // Add rapidly improving fitness
    for (let i = 0; i < 10; i++) {
      detector.recordFitness(-1.0 + i * 0.05);
    }

    // During rapid improvement, multiplier should be 0.8 (20% reduction)
    assertEquals(detector.getMutationMultiplier(), 0.8);
  },
);

Deno.test(
  "PlateauDetector: getMutationMultiplier returns 1.0 during stable progress",
  () => {
    const detector = new PlateauDetector({
      ...DEFAULT_PLATEAU_DETECTION,
      windowSize: 5,
      minImprovementRate: 0.001, // 0.1% minimum
      rapidImprovementRate: 0.01, // 1% for rapid
      responseMutationMultiplier: 2.0,
      responseImprovementMultiplier: 0.8,
      enabled: true,
    });

    // Add stable improvement - between stagnation and rapid improvement
    // 0.5% improvement over window
    for (let i = 0; i < 10; i++) {
      detector.recordFitness(-1.0 + i * 0.001);
    }

    // During stable progress, multiplier should be 1.0 (no change)
    assertEquals(detector.getMutationMultiplier(), 1.0);
  },
);

Deno.test(
  "PlateauDetector: getMutationMultiplier returns > 1 during stagnation",
  () => {
    const detector = new PlateauDetector({
      ...DEFAULT_PLATEAU_DETECTION,
      windowSize: 5,
      minImprovementRate: 0.001,
      rapidImprovementRate: 0.01,
      responseMutationMultiplier: 2.0,
      responseImprovementMultiplier: 0.8,
      enabled: true,
    });

    // Add stagnant fitness
    for (let i = 0; i < 10; i++) {
      detector.recordFitness(-0.5);
    }

    // During stagnation, multiplier should be 2.0 (100% increase)
    assertEquals(detector.getMutationMultiplier(), 2.0);
  },
);

// ============================================================================
// State Transitions
// ============================================================================

Deno.test("PlateauDetector: transitions correctly between states", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 3,
    minImprovementRate: 0.001,
    rapidImprovementRate: 0.01,
    responseMutationMultiplier: 2.0,
    responseImprovementMultiplier: 0.8,
    enabled: true,
  });

  // Phase 1: Rapid improvement
  detector.recordFitness(-1.0);
  detector.recordFitness(-0.9);
  detector.recordFitness(-0.8);
  assertEquals(detector.isImproving(), true);
  assertEquals(detector.getMutationMultiplier(), 0.8);

  // Phase 2: Stagnation
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-0.8);
  }
  assertEquals(detector.isOnPlateau(), true);
  assertEquals(detector.isImproving(), false);
  assertEquals(detector.getMutationMultiplier(), 2.0);

  // Phase 3: Rapid improvement again
  detector.recordFitness(-0.7);
  detector.recordFitness(-0.6);
  detector.recordFitness(-0.5);
  assertEquals(detector.isImproving(), true);
  assertEquals(detector.getMutationMultiplier(), 0.8);
});

Deno.test("PlateauDetector: reset clears improvement tracking", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 3,
    rapidImprovementRate: 0.01,
    responseImprovementMultiplier: 0.8,
    enabled: true,
  });

  // Add improving fitness
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-1.0 + i * 0.1);
  }
  assertEquals(detector.isImproving(), true);

  // Reset
  detector.reset();

  // Should no longer be improving (insufficient history)
  assertEquals(detector.isImproving(), false);
  assertEquals(detector.getMutationMultiplier(), 1.0);
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("PlateauDetector: handles negative fitness improvements correctly", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    rapidImprovementRate: 0.01,
    responseImprovementMultiplier: 0.8,
    enabled: true,
  });

  // In NEAT, higher scores are better
  // -0.1 is better than -0.5
  detector.recordFitness(-0.5);
  detector.recordFitness(-0.4);
  detector.recordFitness(-0.3);
  detector.recordFitness(-0.2);
  detector.recordFitness(-0.1);

  // This is 80% improvement relative to absolute value of starting point
  assertEquals(detector.isImproving(), true);
});

Deno.test(
  "PlateauDetector: improvement detection respects responseImprovementMultiplier of 1.0",
  () => {
    const detector = new PlateauDetector({
      ...DEFAULT_PLATEAU_DETECTION,
      windowSize: 5,
      rapidImprovementRate: 0.01,
      responseImprovementMultiplier: 1.0, // No mutation rate change
      responseMutationMultiplier: 2.0,
      enabled: true,
    });

    // Add rapidly improving fitness
    for (let i = 0; i < 10; i++) {
      detector.recordFitness(-1.0 + i * 0.1);
    }

    // Even during rapid improvement, multiplier should be 1.0
    assertEquals(detector.isImproving(), true);
    assertEquals(detector.getMutationMultiplier(), 1.0);
  },
);

// ============================================================================
// Defaults Integration Test
// ============================================================================

Deno.test(
  "AdaptiveMutationFitnessProgress: default values work with existing plateau detection",
  () => {
    const config = createNeatConfig({});

    // All defaults should be set correctly
    assertEquals(config.plateauDetection.windowSize, 10);
    assertEquals(config.plateauDetection.minImprovementRate, 0.001);
    assertEquals(config.plateauDetection.responseMutationMultiplier, 2.0);
    assertEquals(config.plateauDetection.enabled, false);
    // New fields from issue #1012
    assertEquals(config.plateauDetection.responseImprovementMultiplier, 0.8);
    assertEquals(config.plateauDetection.rapidImprovementRate, 0.01);
  },
);
