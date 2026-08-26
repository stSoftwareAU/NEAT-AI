/**
 * Tests for TrainingParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "@config/QuantumStepConfig.ts";
import {
  parsePredictiveCoding,
  parseQuantumStep,
} from "@config/parsers/TrainingParsers.ts";

Deno.test("parseQuantumStep - returns defaults", () => {
  const cfg = parseQuantumStep(undefined);
  assertEquals(cfg.minStep, DEFAULT_QUANTUM_STEP_CONFIG.minStep);
  assertEquals(cfg.maxStep, DEFAULT_QUANTUM_STEP_CONFIG.maxStep);
  assertEquals(cfg.errorScale, DEFAULT_QUANTUM_STEP_CONFIG.errorScale);
});

Deno.test("parseQuantumStep - applies overrides", () => {
  const cfg = parseQuantumStep({
    minStep: 0.0001,
    maxStep: 0.5,
    errorScale: 1.5,
  });
  assertEquals(cfg.minStep, 0.0001);
  assertEquals(cfg.maxStep, 0.5);
  assertEquals(cfg.errorScale, 1.5);
});

Deno.test("parseQuantumStep - rejects errorScale below 0", () => {
  assertThrows(
    () => parseQuantumStep({ errorScale: -0.1 }),
    ConfigurationError,
  );
});

Deno.test("parsePredictiveCoding - returns defaults", () => {
  const cfg = parsePredictiveCoding(undefined);
  assertEquals(cfg.enabled, DEFAULT_PREDICTIVE_CODING_CONFIG.enabled);
  assertEquals(
    cfg.inferenceSteps,
    DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceSteps,
  );
});

Deno.test("parsePredictiveCoding - applies overrides", () => {
  const cfg = parsePredictiveCoding({
    enabled: true,
    inferenceSteps: 5,
    inferenceRate: 0.5,
    learningRate: 0.01,
    energyThreshold: 0.001,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.inferenceSteps, 5);
  assertEquals(cfg.inferenceRate, 0.5);
  assertEquals(cfg.learningRate, 0.01);
  assertEquals(cfg.energyThreshold, 0.001);
});

Deno.test("parsePredictiveCoding - rejects inferenceSteps below 1", () => {
  assertThrows(
    () => parsePredictiveCoding({ inferenceSteps: 0 }),
    ConfigurationError,
  );
});
