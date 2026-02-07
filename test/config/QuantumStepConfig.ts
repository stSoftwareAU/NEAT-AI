import {
  assertEquals,
  assertGreater,
  assertLessOrEqual,
  assertThrows,
} from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "../../src/config/QuantumStepConfig.ts";

Deno.test("QuantumStepConfig - defaults applied when not specified", () => {
  const config = createNeatConfig({});
  assertEquals(config.quantumStep.minStep, DEFAULT_QUANTUM_STEP_CONFIG.minStep);
  assertEquals(config.quantumStep.maxStep, DEFAULT_QUANTUM_STEP_CONFIG.maxStep);
  assertEquals(
    config.quantumStep.errorScale,
    DEFAULT_QUANTUM_STEP_CONFIG.errorScale,
  );
});

Deno.test("QuantumStepConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    quantumStep: {
      minStep: 0.001,
      maxStep: 0.1,
      errorScale: 5,
    },
  });
  assertEquals(config.quantumStep.minStep, 0.001);
  assertEquals(config.quantumStep.maxStep, 0.1);
  assertEquals(config.quantumStep.errorScale, 5);
});

Deno.test("QuantumStepConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    quantumStep: {
      errorScale: 20,
    },
  });
  assertEquals(config.quantumStep.minStep, DEFAULT_QUANTUM_STEP_CONFIG.minStep);
  assertEquals(config.quantumStep.maxStep, DEFAULT_QUANTUM_STEP_CONFIG.maxStep);
  assertEquals(config.quantumStep.errorScale, 20);
});

Deno.test("QuantumStepConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    quantumStep: {
      minStep: "0.001" as unknown as number,
      maxStep: "0.1" as unknown as number,
      errorScale: "5" as unknown as number,
    },
  });
  assertEquals(config.quantumStep.minStep, 0.001);
  assertEquals(config.quantumStep.maxStep, 0.1);
  assertEquals(config.quantumStep.errorScale, 5);
});

Deno.test("QuantumStepConfig - maxStep less than minStep throws", () => {
  assertThrows(
    () =>
      createNeatConfig({
        quantumStep: {
          minStep: 0.1,
          maxStep: 0.001,
        },
      }),
    Error,
    "maxStep must be >= minStep",
  );
});

Deno.test("QuantumStepConfig - default values are sensible", () => {
  assertGreater(DEFAULT_QUANTUM_STEP_CONFIG.minStep, 0);
  assertGreater(DEFAULT_QUANTUM_STEP_CONFIG.maxStep, 0);
  assertGreater(
    DEFAULT_QUANTUM_STEP_CONFIG.maxStep,
    DEFAULT_QUANTUM_STEP_CONFIG.minStep,
  );
  assertLessOrEqual(DEFAULT_QUANTUM_STEP_CONFIG.errorScale, 100);
});

Deno.test("QuantumStepConfig - errorScale zero disables adaptation", () => {
  const config = createNeatConfig({
    quantumStep: {
      errorScale: 0,
    },
  });
  assertEquals(config.quantumStep.errorScale, 0);
});
