import { assert, assertEquals } from "@std/assert";
import {
  calculateStepSize,
  MIN_STEP,
  quantumAdjust,
} from "../../src/blackbox/FineTune.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "../../src/config/QuantumStepConfig.ts";

Deno.test("calculateStepSize - returns minStep when scores are equal", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const step = calculateStepSize(-0.5, -0.5, config);
  assertEquals(step, config.minStep);
});

Deno.test("calculateStepSize - returns minStep when no previous score", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const step = calculateStepSize(-0.5, undefined, config);
  assertEquals(step, config.minStep);
});

Deno.test("calculateStepSize - larger step for larger score difference", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const smallDiff = calculateStepSize(-0.4, -0.5, config);
  const largeDiff = calculateStepSize(-0.1, -0.9, config);
  assert(
    largeDiff > smallDiff,
    `Large diff step (${largeDiff}) should be greater than small diff step (${smallDiff})`,
  );
});

Deno.test("calculateStepSize - step never exceeds maxStep", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  // Very large score difference
  const step = calculateStepSize(0, -1000, config);
  assert(
    step <= config.maxStep,
    `Step (${step}) should not exceed maxStep (${config.maxStep})`,
  );
});

Deno.test("calculateStepSize - step never below minStep", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  // Tiny score difference
  const step = calculateStepSize(-0.5, -0.500001, config);
  assert(
    step >= config.minStep,
    `Step (${step}) should not be below minStep (${config.minStep})`,
  );
});

Deno.test("calculateStepSize - custom config respected", () => {
  const config: RequiredQuantumStepConfig = {
    minStep: 0.001,
    maxStep: 0.1,
    scaleFactor: 5,
  };
  const step = calculateStepSize(-0.1, -0.5, config);
  assert(
    step >= config.minStep,
    `Step (${step}) should be >= minStep (${config.minStep})`,
  );
  assert(
    step <= config.maxStep,
    `Step (${step}) should be <= maxStep (${config.maxStep})`,
  );
});

Deno.test("calculateStepSize - scaleFactor zero means always minStep", () => {
  const config: RequiredQuantumStepConfig = {
    minStep: 0.000_000_1,
    maxStep: 0.000_1,
    scaleFactor: 0,
  };
  const step = calculateStepSize(-0.1, -0.9, config);
  assertEquals(step, config.minStep);
});

Deno.test("quantumAdjust - uses custom step size", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const forwardOnly = true;
  const customStep = 0.01;

  const result = quantumAdjust(
    currentBest,
    previousBest,
    forwardOnly,
    false,
    undefined,
    undefined,
    customStep,
  );

  // The result should be quantised to the custom step size
  const quantumValue = Math.round(result.value / customStep);
  const reQuantised = quantumValue * customStep;
  assert(
    Math.abs(result.value - reQuantised) < customStep / 100,
    `Value (${result.value}) should be quantised to step ${customStep}, re-quantised: ${reQuantised}`,
  );
  assert(result.changed, "Result should indicate a change");
});

Deno.test("quantumAdjust - default step size preserves backward compatibility", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const forwardOnly = true;

  // Without custom step - should use MIN_STEP (default behaviour)
  const result = quantumAdjust(
    currentBest,
    previousBest,
    forwardOnly,
    false,
  );

  const quantumValue = Math.round(result.value / MIN_STEP);
  const reQuantised = quantumValue * MIN_STEP;
  assert(
    Math.abs(result.value - reQuantised) < MIN_STEP / 100,
    `Value (${result.value}) should be quantised to MIN_STEP ${MIN_STEP}`,
  );
});

Deno.test("quantumAdjust - larger step size produces coarser quantisation", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const forwardOnly = true;
  const largeStep = 0.1;

  const result = quantumAdjust(
    currentBest,
    previousBest,
    forwardOnly,
    false,
    undefined,
    undefined,
    largeStep,
  );

  // Should be quantised to 0.1 increments
  const quantumValue = Math.round(result.value / largeStep);
  const reQuantised = quantumValue * largeStep;
  assert(
    Math.abs(result.value - reQuantised) < largeStep / 100,
    `Value (${result.value}) should be quantised to step ${largeStep}, got ${reQuantised}`,
  );
});
