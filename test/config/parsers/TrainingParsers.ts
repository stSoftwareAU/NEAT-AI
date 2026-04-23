/**
 * Tests for TrainingParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_CROSS_VALIDATION_CONFIG } from "@config/CrossValidationConfig.ts";
import { DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG } from "@config/HyperparameterConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "@config/QuantumStepConfig.ts";
import {
  parseCrossValidation,
  parseHyperparameterEvolution,
  parsePredictiveCoding,
  parseQuantumStep,
} from "@config/parsers/TrainingParsers.ts";

Deno.test("parseHyperparameterEvolution - returns defaults", () => {
  const cfg = parseHyperparameterEvolution(undefined);
  assertEquals(cfg.enabled, DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.enabled);
  assertEquals(
    cfg.minLearningRate,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.minLearningRate,
  );
});

Deno.test("parseHyperparameterEvolution - applies overrides", () => {
  const cfg = parseHyperparameterEvolution({
    enabled: true,
    minLearningRate: 0.0001,
    maxLearningRate: 0.5,
    mutationStdDev: 0.1,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.minLearningRate, 0.0001);
  assertEquals(cfg.maxLearningRate, 0.5);
  assertEquals(cfg.mutationStdDev, 0.1);
});

Deno.test("parseHyperparameterEvolution - rejects minLearningRate of 0 (exclusive)", () => {
  assertThrows(
    () => parseHyperparameterEvolution({ minLearningRate: 0 }),
    ConfigurationError,
  );
});

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

Deno.test("parseCrossValidation - returns defaults", () => {
  const cfg = parseCrossValidation(undefined);
  assertEquals(cfg.enabled, DEFAULT_CROSS_VALIDATION_CONFIG.enabled);
  assertEquals(cfg.folds, DEFAULT_CROSS_VALIDATION_CONFIG.folds);
});

Deno.test("parseCrossValidation - applies overrides", () => {
  const cfg = parseCrossValidation({
    enabled: true,
    folds: 5,
    validationEarlyStopping: true,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.folds, 5);
  assertEquals(cfg.validationEarlyStopping, true);
});

Deno.test("parseCrossValidation - rejects folds above 20", () => {
  assertThrows(
    () => parseCrossValidation({ folds: 21 }),
    ConfigurationError,
  );
});
