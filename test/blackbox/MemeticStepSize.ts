import { assert, assertEquals, assertThrows } from "@std/assert";
import { MIN_STEP, quantumAdjust } from "../../src/blackbox/FineTune.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_MEMETIC_STEP_CONFIG } from "../../src/config/MemeticStepConfig.ts";

Deno.test("quantumAdjust - uses custom step size", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const customStep = 0.01; // Much larger than default MIN_STEP

  const result = quantumAdjust(
    currentBest,
    previousBest,
    true,
    false,
    undefined,
    undefined,
    customStep,
  );

  assert(result.changed, "Should have changed");
  // With a larger step size, the result should be quantised to customStep multiples
  const quantum = Math.round(result.value / customStep);
  const quantisedValue = quantum * customStep;
  assertEquals(
    result.value,
    quantisedValue,
    `Result ${result.value} should be a multiple of step size ${customStep}`,
  );
});

Deno.test("quantumAdjust - default step size matches MIN_STEP", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;

  // Call without step size (should use MIN_STEP)
  const result1 = quantumAdjust(currentBest, previousBest, true, false);

  assert(result1.changed, "Should have changed");
  // Verify result is quantised to MIN_STEP
  const quantum = Math.round(result1.value / MIN_STEP);
  const quantisedValue = quantum * MIN_STEP;
  const tolerance = MIN_STEP / 10;
  assert(
    Math.abs(result1.value - quantisedValue) < tolerance,
    `Result ${result1.value} should be a multiple of MIN_STEP ${MIN_STEP}`,
  );
});

Deno.test("quantumAdjust - larger step produces coarser quantisation", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const smallStep = MIN_STEP;
  const largeStep = 0.01;

  // Run multiple trials to confirm coarser quantisation with larger step
  let smallStepMinDiff = Infinity;
  let largeStepMinDiff = Infinity;

  for (let i = 0; i < 50; i++) {
    const smallResult = quantumAdjust(
      currentBest,
      previousBest,
      true,
      false,
      undefined,
      undefined,
      smallStep,
    );
    const largeResult = quantumAdjust(
      currentBest,
      previousBest,
      true,
      false,
      undefined,
      undefined,
      largeStep,
    );

    if (smallResult.changed) {
      const diff = Math.abs(smallResult.value - currentBest);
      if (diff < smallStepMinDiff) smallStepMinDiff = diff;
    }
    if (largeResult.changed) {
      const diff = Math.abs(largeResult.value - currentBest);
      if (diff < largeStepMinDiff) largeStepMinDiff = diff;
    }
  }

  // The minimum difference for large step should be >= largeStep
  assert(
    largeStepMinDiff >= largeStep - largeStep / 10,
    `Large step minimum difference ${largeStepMinDiff} should be >= ${largeStep}`,
  );
});

Deno.test("quantumAdjust - no change when diff below step size", () => {
  const customStep = 0.01;
  const currentBest = 1.0;
  // Difference is smaller than step size
  const previousBest = 1.0 + customStep / 2;

  const result = quantumAdjust(
    currentBest,
    previousBest,
    true,
    false,
    undefined,
    undefined,
    customStep,
  );

  assertEquals(result.changed, false, "Should not change when diff < step");
  assertEquals(result.value, currentBest);
});

Deno.test("calculateAdaptiveStepSize - returns bounded step", async () => {
  const { calculateAdaptiveStepSize } = await import(
    "../../src/blackbox/FineTune.ts"
  );

  const config = DEFAULT_MEMETIC_STEP_CONFIG;

  // When score is 0 (perfect), step should be at minimum
  const minResult = calculateAdaptiveStepSize(0, config);
  assertEquals(
    minResult,
    config.minStepSize,
    "Perfect score should yield minimum step",
  );

  // When score is very negative (far from optimum), step should be larger
  const largeResult = calculateAdaptiveStepSize(-1.0, config);
  assert(
    largeResult > config.minStepSize,
    `Step ${largeResult} should be > minStepSize ${config.minStepSize} for poor score`,
  );
  assert(
    largeResult <= config.maxStepSize,
    `Step ${largeResult} should be <= maxStepSize ${config.maxStepSize}`,
  );
});

Deno.test("calculateAdaptiveStepSize - respects maxStepSize cap", async () => {
  const { calculateAdaptiveStepSize } = await import(
    "../../src/blackbox/FineTune.ts"
  );

  const config = {
    minStepSize: 0.000_000_1,
    maxStepSize: 0.001,
    errorScale: 10,
  };

  // Very large error should still be capped at maxStepSize
  // rawStep = 0.0000001 * (1 + 10 * 10000) = 0.0100001, exceeds maxStepSize
  const result = calculateAdaptiveStepSize(-10000, config);
  assertEquals(
    result,
    config.maxStepSize,
    "Very large error should be capped at maxStepSize",
  );
});

Deno.test("calculateAdaptiveStepSize - scales with error magnitude", async () => {
  const { calculateAdaptiveStepSize } = await import(
    "../../src/blackbox/FineTune.ts"
  );

  const config = DEFAULT_MEMETIC_STEP_CONFIG;

  const smallError = calculateAdaptiveStepSize(-0.01, config);
  const largeError = calculateAdaptiveStepSize(-0.5, config);

  assert(
    largeError > smallError,
    `Larger error step ${largeError} should be > smaller error step ${smallError}`,
  );
});

Deno.test("NeatConfig - memeticStep defaults applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.memeticStep.minStepSize,
    DEFAULT_MEMETIC_STEP_CONFIG.minStepSize,
  );
  assertEquals(
    config.memeticStep.maxStepSize,
    DEFAULT_MEMETIC_STEP_CONFIG.maxStepSize,
  );
  assertEquals(
    config.memeticStep.errorScale,
    DEFAULT_MEMETIC_STEP_CONFIG.errorScale,
  );
});

Deno.test("NeatConfig - memeticStep custom values", () => {
  const config = createNeatConfig({
    memeticStep: {
      minStepSize: 0.000_001,
      maxStepSize: 0.01,
      errorScale: 5,
    },
  });
  assertEquals(config.memeticStep.minStepSize, 0.000_001);
  assertEquals(config.memeticStep.maxStepSize, 0.01);
  assertEquals(config.memeticStep.errorScale, 5);
});

Deno.test("NeatConfig - memeticStep partial overrides", () => {
  const config = createNeatConfig({
    memeticStep: {
      errorScale: 20,
    },
  });
  assertEquals(
    config.memeticStep.minStepSize,
    DEFAULT_MEMETIC_STEP_CONFIG.minStepSize,
    "minStepSize should use default",
  );
  assertEquals(config.memeticStep.errorScale, 20);
});

Deno.test("NeatConfig - memeticStep validation: maxStepSize < minStepSize", () => {
  assertThrows(
    () => {
      createNeatConfig({
        memeticStep: {
          minStepSize: 0.01,
          maxStepSize: 0.001,
        },
      });
    },
    Error,
    "maxStepSize must be >= minStepSize",
  );
});

Deno.test("NeatConfig - memeticStep string coercion from CLI", () => {
  const config = createNeatConfig({
    memeticStep: {
      minStepSize: "0.001" as unknown as number,
      maxStepSize: "0.01" as unknown as number,
      errorScale: "5" as unknown as number,
    },
  });
  assertEquals(config.memeticStep.minStepSize, 0.001);
  assertEquals(config.memeticStep.maxStepSize, 0.01);
  assertEquals(config.memeticStep.errorScale, 5);
});
