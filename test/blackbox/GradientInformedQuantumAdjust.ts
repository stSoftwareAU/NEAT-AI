import { assert, assertEquals } from "@std/assert";
import {
  type GradientHint,
  quantumAdjust,
} from "../../src/blackbox/FineTune.ts";

Deno.test("quantumAdjust - gradient hint biases direction towards gradient sign", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  // With a positive gradient hint, the adjustment should tend to be positive
  const gradientHint: GradientHint = {
    direction: 1,
    magnitude: 0.8,
  };

  // Run multiple trials to verify statistical bias
  let positiveCount = 0;
  const trials = 100;
  for (let i = 0; i < trials; i++) {
    const result = quantumAdjust(
      currentBest,
      previousBest,
      false, // not forward only, so direction can vary
      false,
      undefined,
      undefined,
      undefined,
      gradientHint,
    );
    if (result.value > currentBest) {
      positiveCount++;
    }
  }

  // With gradient direction = 1, we expect more positive adjustments
  // than without it (the base rate without gradient is ~50%)
  assert(
    positiveCount > trials * 0.5,
    `Expected gradient-biased positive count > ${
      trials * 0.5
    }, got ${positiveCount}`,
  );
});

Deno.test("quantumAdjust - gradient hint with negative direction", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  const gradientHint: GradientHint = {
    direction: -1,
    magnitude: 0.8,
  };

  // Run multiple trials
  let negativeCount = 0;
  const trials = 100;
  for (let i = 0; i < trials; i++) {
    const result = quantumAdjust(
      currentBest,
      previousBest,
      false,
      false,
      undefined,
      undefined,
      undefined,
      gradientHint,
    );
    if (result.value < currentBest) {
      negativeCount++;
    }
  }

  // With gradient direction = -1, we expect more negative adjustments
  assert(
    negativeCount > trials * 0.5,
    `Expected gradient-biased negative count > ${
      trials * 0.5
    }, got ${negativeCount}`,
  );
});

Deno.test("quantumAdjust - gradient hint with zero direction has no directional bias", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  const gradientHint: GradientHint = {
    direction: 0,
    magnitude: 0.5,
  };

  // With zero direction, behaviour should be similar to no gradient hint
  const result = quantumAdjust(
    currentBest,
    previousBest,
    true,
    false,
    undefined,
    undefined,
    undefined,
    gradientHint,
  );

  // Should still produce a changed result
  assertEquals(result.changed, true);
});

Deno.test("quantumAdjust - gradient hint with zero magnitude has no effect", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  const gradientHint: GradientHint = {
    direction: 1,
    magnitude: 0,
  };

  // Zero magnitude should not apply any gradient influence
  const result = quantumAdjust(
    currentBest,
    previousBest,
    true,
    false,
    undefined,
    undefined,
    undefined,
    gradientHint,
  );

  assertEquals(result.changed, true);
});

Deno.test("quantumAdjust - backward compatible without gradient hint", () => {
  const result = quantumAdjust(1.0, 0.5, true, false);
  assertEquals(result.changed, true);
});

Deno.test("quantumAdjust - gradient hint combined with momentum", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  const gradientHint: GradientHint = {
    direction: 1,
    magnitude: 0.7,
  };

  // Should work with both momentum and gradient hint
  const result = quantumAdjust(
    currentBest,
    previousBest,
    true,
    false,
    1.5, // momentum factor
    1, // suggested direction
    undefined,
    gradientHint,
  );

  assertEquals(result.changed, true);
  // Both momentum and gradient agree on positive direction, so result should be positive
  assert(
    result.value > currentBest,
    `Expected value > ${currentBest}, got ${result.value}`,
  );
});

Deno.test("quantumAdjust - gradient hint produces finite values", () => {
  const gradientHint: GradientHint = {
    direction: 1,
    magnitude: 1.0,
  };

  const result = quantumAdjust(
    0.5,
    0.3,
    true,
    false,
    undefined,
    undefined,
    undefined,
    gradientHint,
  );

  assert(
    Number.isFinite(result.value),
    `Result should be finite: ${result.value}`,
  );
});

Deno.test("quantumAdjust - gradient hint does not prevent changed=false when no diff", () => {
  const gradientHint: GradientHint = {
    direction: 1,
    magnitude: 0.5,
  };

  const result = quantumAdjust(
    1.0,
    1.0, // same as current, so no diff
    true,
    false,
    undefined,
    undefined,
    undefined,
    gradientHint,
  );

  // Even with gradient hint, if there's no diff, changed should be false
  assertEquals(result.changed, false);
});
