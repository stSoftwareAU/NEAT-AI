/**
 * Tests for fitness plateau detection and stagnation response.
 *
 * Issue #1039: Performance: Implement fitness plateau detection with stagnation response
 *
 * These tests verify:
 * 1. Configuration validation for plateau detection settings
 * 2. Plateau detection logic (detecting when improvement rate falls below threshold)
 * 3. Stagnation response (mutation rate adjustment)
 */
import { assert, assertEquals, assertGreater, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  detectPlateau,
  PlateauDetector,
} from "../../src/NEAT/PlateauDetector.ts";

// ============================================================================
// Configuration Tests
// ============================================================================

Deno.test("PlateauDetection - default configuration values", () => {
  const config = createNeatConfig({});

  // Verify defaults are applied
  assertEquals(
    config.plateauDetection.windowSize,
    DEFAULT_PLATEAU_DETECTION.windowSize,
    "Default windowSize should match",
  );
  assertEquals(
    config.plateauDetection.minImprovementRate,
    DEFAULT_PLATEAU_DETECTION.minImprovementRate,
    "Default minImprovementRate should match",
  );
  assertEquals(
    config.plateauDetection.responseMutationMultiplier,
    DEFAULT_PLATEAU_DETECTION.responseMutationMultiplier,
    "Default responseMutationMultiplier should match",
  );
  assertEquals(
    config.plateauDetection.enabled,
    DEFAULT_PLATEAU_DETECTION.enabled,
    "Default enabled should match",
  );
});

Deno.test("PlateauDetection - custom configuration", () => {
  const config = createNeatConfig({
    plateauDetection: {
      windowSize: 20,
      minImprovementRate: 0.005,
      responseMutationMultiplier: 3.0,
      enabled: true,
    },
  });

  assertEquals(config.plateauDetection.windowSize, 20);
  assertEquals(config.plateauDetection.minImprovementRate, 0.005);
  assertEquals(config.plateauDetection.responseMutationMultiplier, 3.0);
  assertEquals(config.plateauDetection.enabled, true);
});

Deno.test("PlateauDetection - partial configuration uses defaults for unspecified", () => {
  const config = createNeatConfig({
    plateauDetection: {
      windowSize: 15,
    },
  });

  assertEquals(config.plateauDetection.windowSize, 15);
  assertEquals(
    config.plateauDetection.minImprovementRate,
    DEFAULT_PLATEAU_DETECTION.minImprovementRate,
  );
  assertEquals(
    config.plateauDetection.responseMutationMultiplier,
    DEFAULT_PLATEAU_DETECTION.responseMutationMultiplier,
  );
});

Deno.test("PlateauDetection - validation: windowSize must be positive integer", () => {
  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          windowSize: 0,
        },
      });
    },
    Error,
    "windowSize",
  );

  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          windowSize: -5,
        },
      });
    },
    Error,
    "windowSize",
  );

  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          windowSize: 3.5,
        },
      });
    },
    Error,
    "windowSize",
  );
});

Deno.test("PlateauDetection - validation: minImprovementRate must be between 0 and 1", () => {
  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          minImprovementRate: -0.1,
        },
      });
    },
    Error,
    "minImprovementRate",
  );

  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          minImprovementRate: 1.5,
        },
      });
    },
    Error,
    "minImprovementRate",
  );
});

Deno.test("PlateauDetection - validation: responseMutationMultiplier must be >= 1", () => {
  assertThrows(
    () => {
      createNeatConfig({
        plateauDetection: {
          responseMutationMultiplier: 0.5,
        },
      });
    },
    Error,
    "responseMutationMultiplier",
  );

  // 1.0 should be valid (no change)
  const config = createNeatConfig({
    plateauDetection: {
      responseMutationMultiplier: 1.0,
    },
  });
  assertEquals(config.plateauDetection.responseMutationMultiplier, 1.0);
});

// ============================================================================
// Plateau Detection Logic Tests
// ============================================================================

Deno.test("PlateauDetector - no plateau when insufficient history", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Add fewer samples than window size
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-0.5 + i * 0.1); // Improving fitness
  }

  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector - no plateau when fitness is improving", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Add improving fitness values (scores getting higher = better)
  // Start at -1.0 and improve by 0.01 each generation = 1% improvement
  for (let i = 0; i < 15; i++) {
    detector.recordFitness(-1.0 + i * 0.01);
  }

  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector - detects plateau when fitness stagnates", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.001, // 0.1% minimum improvement
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Add stagnant fitness values - no improvement over window
  const stagnantFitness = -0.5;
  for (let i = 0; i < 15; i++) {
    detector.recordFitness(stagnantFitness);
  }

  assertEquals(detector.isOnPlateau(), true);
});

Deno.test("PlateauDetector - detects plateau when improvement is below threshold", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.01, // 1% minimum improvement
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Very slow improvement: 0.1% per generation over 15 generations
  // Total improvement over window (10 gens): 0.1% * 10 = 1%
  // But we need 1% per window, so 0.001 per window is below threshold
  const baseFitness = -1.0;
  for (let i = 0; i < 15; i++) {
    detector.recordFitness(baseFitness + i * 0.0001); // 0.01% per generation
  }

  assertEquals(detector.isOnPlateau(), true);
});

Deno.test("PlateauDetector - exits plateau when improvement resumes", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // First, stagnate
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }
  assertEquals(detector.isOnPlateau(), true);

  // Then improve significantly
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5 + (i + 1) * 0.1);
  }
  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector - disabled detector never reports plateau", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: false,
  });

  // Add stagnant fitness - would normally trigger plateau
  for (let i = 0; i < 20; i++) {
    detector.recordFitness(-0.5);
  }

  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector - getMutationMultiplier returns 1.0 when not on plateau", () => {
  const detector = new PlateauDetector({
    windowSize: 10,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // No data yet
  assertEquals(detector.getMutationMultiplier(), 1.0);

  // Improving fitness
  for (let i = 0; i < 15; i++) {
    detector.recordFitness(-1.0 + i * 0.1);
  }
  assertEquals(detector.getMutationMultiplier(), 1.0);
});

Deno.test("PlateauDetector - getMutationMultiplier returns configured value on plateau", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.5,
    enabled: true,
  });

  // Stagnant fitness
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }

  assertEquals(detector.getMutationMultiplier(), 2.5);
});

Deno.test("PlateauDetector - getImprovementRate calculates correctly", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Add 5 values with 10% total improvement over window
  // Start: -1.0, End: -0.9 -> improvement = 0.1, rate = 0.1/1.0 = 10%
  detector.recordFitness(-1.0);
  detector.recordFitness(-0.975);
  detector.recordFitness(-0.95);
  detector.recordFitness(-0.925);
  detector.recordFitness(-0.9);

  const rate = detector.getImprovementRate();
  // Rate should be approximately 0.1 (10%)
  assert(rate !== null);
  assertGreater(rate, 0.09);
});

Deno.test("PlateauDetector - reset clears history", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Add stagnant fitness to trigger plateau
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }
  assertEquals(detector.isOnPlateau(), true);

  // Reset
  detector.reset();

  // Should no longer be on plateau (insufficient history)
  assertEquals(detector.isOnPlateau(), false);
  assertEquals(detector.getImprovementRate(), null);
});

// ============================================================================
// Utility Function Tests
// ============================================================================

Deno.test("detectPlateau - utility function works correctly", () => {
  const history = [-1.0, -0.95, -0.9, -0.85, -0.8];
  const result = detectPlateau(history, 5, 0.001);
  assertEquals(result.onPlateau, false);
  assertGreater(result.improvementRate, 0);

  // Stagnant history
  const stagnantHistory = [-0.5, -0.5, -0.5, -0.5, -0.5];
  const stagnantResult = detectPlateau(stagnantHistory, 5, 0.001);
  assertEquals(stagnantResult.onPlateau, true);
  assertEquals(stagnantResult.improvementRate, 0);
});

Deno.test("detectPlateau - handles edge cases", () => {
  // Empty history
  const emptyResult = detectPlateau([], 5, 0.001);
  assertEquals(emptyResult.onPlateau, false);
  assertEquals(emptyResult.improvementRate, 0);

  // History shorter than window
  const shortResult = detectPlateau([-1.0, -0.9], 5, 0.001);
  assertEquals(shortResult.onPlateau, false);
});

// ============================================================================
// Edge Case Tests
// ============================================================================

Deno.test("PlateauDetector - handles negative fitness values correctly", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // In NEAT, scores are typically negative (higher is better)
  // -0.1 is better than -0.5
  detector.recordFitness(-0.5);
  detector.recordFitness(-0.4);
  detector.recordFitness(-0.3);
  detector.recordFitness(-0.2);
  detector.recordFitness(-0.1);

  assertEquals(detector.isOnPlateau(), false);
  const rate = detector.getImprovementRate();
  assert(rate !== null && rate > 0);
});

Deno.test("PlateauDetector - handles zero fitness values", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // All zero - stagnant
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(0);
  }

  assertEquals(detector.isOnPlateau(), true);
});

Deno.test("PlateauDetector - handles fitness approaching zero", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Improving towards zero (getting better)
  detector.recordFitness(-0.05);
  detector.recordFitness(-0.04);
  detector.recordFitness(-0.03);
  detector.recordFitness(-0.02);
  detector.recordFitness(-0.01);

  assertEquals(detector.isOnPlateau(), false);
});

Deno.test("PlateauDetector - getGenerationsOnPlateau returns correct count", () => {
  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Not on plateau initially
  assertEquals(detector.getGenerationsOnPlateau(), 0);

  // Add stagnant values to trigger plateau
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }

  // Should have been on plateau for several generations
  assertGreater(detector.getGenerationsOnPlateau(), 0);
});
