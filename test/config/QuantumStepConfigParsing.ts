/**
 * Issue #1330: Tests for parsing QuantumStepConfig in NeatConfig.
 */
import { assertEquals, fail } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "../../src/config/QuantumStepConfig.ts";

Deno.test("QuantumStepConfig - defaults used when not specified", () => {
  const config = createNeatConfig({});
  assertEquals(config.quantumStep.minStep, DEFAULT_QUANTUM_STEP_CONFIG.minStep);
  assertEquals(config.quantumStep.maxStep, DEFAULT_QUANTUM_STEP_CONFIG.maxStep);
  assertEquals(
    config.quantumStep.scaleFactor,
    DEFAULT_QUANTUM_STEP_CONFIG.scaleFactor,
  );
});

Deno.test("QuantumStepConfig - custom minStep accepted", () => {
  const config = createNeatConfig({
    quantumStep: { minStep: 0.000_001 },
  });
  assertEquals(config.quantumStep.minStep, 0.000_001);
  assertEquals(config.quantumStep.maxStep, DEFAULT_QUANTUM_STEP_CONFIG.maxStep);
});

Deno.test("QuantumStepConfig - custom maxStep accepted", () => {
  const config = createNeatConfig({
    quantumStep: { maxStep: 0.01 },
  });
  assertEquals(config.quantumStep.maxStep, 0.01);
  assertEquals(config.quantumStep.minStep, DEFAULT_QUANTUM_STEP_CONFIG.minStep);
});

Deno.test("QuantumStepConfig - custom scaleFactor accepted", () => {
  const config = createNeatConfig({
    quantumStep: { scaleFactor: 5 },
  });
  assertEquals(config.quantumStep.scaleFactor, 5);
});

Deno.test("QuantumStepConfig - string values accepted from CLI", () => {
  const config = createNeatConfig({
    quantumStep: {
      minStep: "0.001" as unknown as number,
      maxStep: "0.1" as unknown as number,
      scaleFactor: "5" as unknown as number,
    },
  });
  assertEquals(config.quantumStep.minStep, 0.001);
  assertEquals(config.quantumStep.maxStep, 0.1);
  assertEquals(config.quantumStep.scaleFactor, 5);
});

Deno.test("QuantumStepConfig - maxStep less than minStep throws", () => {
  try {
    createNeatConfig({
      quantumStep: { minStep: 0.01, maxStep: 0.001 },
    });
    fail("Expected error when maxStep < minStep");
  } catch (e) {
    const msg = (e as Error).message;
    assertEquals(
      msg.includes("maxStep") && msg.includes("minStep"),
      true,
      `Error should mention maxStep and minStep: ${msg}`,
    );
  }
});

Deno.test("QuantumStepConfig - negative minStep throws", () => {
  try {
    createNeatConfig({
      quantumStep: { minStep: -0.001 },
    });
    fail("Expected error for negative minStep");
  } catch (e) {
    const msg = (e as Error).message;
    assertEquals(
      msg.includes("Quantum step minStep"),
      true,
      `Error should mention field: ${msg}`,
    );
  }
});

Deno.test("QuantumStepConfig - zero scaleFactor accepted", () => {
  const config = createNeatConfig({
    quantumStep: { scaleFactor: 0 },
  });
  assertEquals(config.quantumStep.scaleFactor, 0);
});
