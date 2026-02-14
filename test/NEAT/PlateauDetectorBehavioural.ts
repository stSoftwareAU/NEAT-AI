import { assert, assertEquals, assertGreater } from "@std/assert";
import {
  DEFAULT_PLATEAU_DETECTION,
  PlateauDetector,
} from "../../src/NEAT/PlateauDetector.ts";

/**
 * Behavioural tests for plateau detection (PlateauDetector.ts).
 *
 * Issue #1439: Verify plateau detection triggers after N generations
 * of no improvement, and verify low false positive rate during active
 * improvement.
 */

// ============================================================================
// Plateau Triggering After N Generations of No Improvement
// ============================================================================

Deno.test("PlateauDetectorBehavioural: triggers plateau after stagnation", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: 2.0,
    enabled: true,
  });

  // Record identical fitness for enough generations
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }

  assertEquals(
    detector.isOnPlateau(),
    true,
    "Should detect plateau when fitness is stagnant",
  );
  assertGreater(
    detector.getGenerationsOnPlateau(),
    0,
    "Should track generations on plateau",
  );
});

Deno.test("PlateauDetectorBehavioural: plateau triggers after exactly windowSize generations", () => {
  const windowSize = 8;
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize,
    minImprovementRate: 0.001,
    enabled: true,
  });

  // Record stagnant fitness values
  for (let i = 0; i < windowSize - 1; i++) {
    detector.recordFitness(-0.5);
    assertEquals(
      detector.isOnPlateau(),
      false,
      `Should not detect plateau before ${windowSize} generations (at ${
        i + 1
      })`,
    );
  }

  // At exactly windowSize, should detect plateau
  detector.recordFitness(-0.5);
  assertEquals(
    detector.isOnPlateau(),
    true,
    `Should detect plateau at generation ${windowSize}`,
  );
});

Deno.test("PlateauDetectorBehavioural: plateau increments generation counter", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    enabled: true,
  });

  // Fill window to trigger plateau
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-0.5);
  }

  const firstCount = detector.getGenerationsOnPlateau();

  // Add more stagnant generations
  for (let i = 0; i < 5; i++) {
    detector.recordFitness(-0.5);
  }

  assertGreater(
    detector.getGenerationsOnPlateau(),
    firstCount,
    "Plateau generation count should increase with continued stagnation",
  );
});

Deno.test("PlateauDetectorBehavioural: plateau resets when improvement resumes", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    enabled: true,
  });

  // Trigger plateau
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }
  assertEquals(detector.isOnPlateau(), true);

  // Resume improvement — large jumps to clearly exit plateau
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5 + (i + 1) * 0.1);
  }

  assertEquals(
    detector.isOnPlateau(),
    false,
    "Plateau should end when improvement resumes",
  );
  assertEquals(
    detector.getGenerationsOnPlateau(),
    0,
    "Plateau counter should reset to 0",
  );
});

Deno.test("PlateauDetectorBehavioural: mutation multiplier increases on plateau", () => {
  const multiplierValue = 3.0;
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    responseMutationMultiplier: multiplierValue,
    enabled: true,
  });

  // Trigger plateau
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-0.5);
  }

  assertEquals(
    detector.getMutationMultiplier(),
    multiplierValue,
    "Mutation multiplier should match configured value on plateau",
  );
});

Deno.test("PlateauDetectorBehavioural: mutation multiplier decreases during rapid improvement", () => {
  const improvementMultiplier = 0.6;
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    rapidImprovementRate: 0.01,
    responseImprovementMultiplier: improvementMultiplier,
    enabled: true,
  });

  // Record rapidly improving fitness (well above rapidImprovementRate)
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-1.0 + i * 0.1);
  }

  assertEquals(
    detector.getMutationMultiplier(),
    improvementMultiplier,
    "Mutation multiplier should decrease during rapid improvement",
  );
});

// ============================================================================
// False Positive Rate During Active Improvement
// ============================================================================

Deno.test("PlateauDetectorBehavioural: no false positives during steady improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 10,
    minImprovementRate: 0.001,
    enabled: true,
  });

  let falsePositives = 0;
  const generations = 50;

  // Simulate steady improvement
  for (let i = 0; i < generations; i++) {
    // 1% improvement per generation from -1.0
    detector.recordFitness(-1.0 + i * 0.01);
    if (detector.isOnPlateau()) {
      falsePositives++;
    }
  }

  assertEquals(
    falsePositives,
    0,
    "Should have zero false positives during steady improvement",
  );
});

Deno.test("PlateauDetectorBehavioural: no false positives during variable improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 10,
    minImprovementRate: 0.001,
    enabled: true,
  });

  let falsePositives = 0;
  const generations = 40;

  // Simulate improvement with some noise (but overall trend is upward)
  for (let i = 0; i < generations; i++) {
    // Average improvement of ~1% per generation with noise
    const noise = Math.sin(i * 1.5) * 0.002;
    detector.recordFitness(-1.0 + i * 0.01 + noise);
    if (i >= 10 && detector.isOnPlateau()) {
      falsePositives++;
    }
  }

  assertEquals(
    falsePositives,
    0,
    "Should have zero false positives during noisy but improving fitness",
  );
});

Deno.test("PlateauDetectorBehavioural: correctly distinguishes improvement from stagnation", () => {
  // Use two detectors with the same config
  const config = {
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    enabled: true,
  };

  const improvingDetector = new PlateauDetector(config);
  const stagnantDetector = new PlateauDetector(config);

  // Feed improving data to one, stagnant data to the other
  for (let i = 0; i < 10; i++) {
    improvingDetector.recordFitness(-1.0 + i * 0.01);
    stagnantDetector.recordFitness(-0.5);
  }

  assertEquals(
    improvingDetector.isOnPlateau(),
    false,
    "Improving detector should not report plateau",
  );
  assertEquals(
    stagnantDetector.isOnPlateau(),
    true,
    "Stagnant detector should report plateau",
  );
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("PlateauDetectorBehavioural: handles negative to less-negative improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    enabled: true,
  });

  // NEAT scores are typically negative; improvement means less negative
  const values = [-0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3];
  for (const v of values) {
    detector.recordFitness(v);
  }

  assertEquals(
    detector.isOnPlateau(),
    false,
    "Should recognise negative-to-less-negative as improvement",
  );
  const rate = detector.getImprovementRate();
  assert(rate !== null && rate > 0, "Improvement rate should be positive");
});

Deno.test("PlateauDetectorBehavioural: isImproving correctly detects rapid improvement", () => {
  const detector = new PlateauDetector({
    ...DEFAULT_PLATEAU_DETECTION,
    windowSize: 5,
    minImprovementRate: 0.001,
    rapidImprovementRate: 0.01,
    enabled: true,
  });

  // Record rapid improvement (well above 1% per window)
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-1.0 + i * 0.1);
  }

  assertEquals(
    detector.isImproving(),
    true,
    "Should detect rapid improvement when rate exceeds threshold",
  );

  // Reset and record slow improvement
  detector.reset();
  for (let i = 0; i < 10; i++) {
    detector.recordFitness(-1.0 + i * 0.0001);
  }

  assertEquals(
    detector.isImproving(),
    false,
    "Should not detect rapid improvement when rate is below threshold",
  );
});
