/**
 * Issue #1614: Runtime validation tests for NeatOptions configuration.
 *
 * Verifies that invalid configuration values are caught at config creation
 * time with clear ConfigurationError messages, rather than causing unexpected
 * behaviour deep in the training loop.
 */
import { assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { ConfigurationError } from "../../src/errors/ConfigurationError.ts";

// --- mutationRate validation ---

Deno.test("NeatOptions validation - mutationRate > 1 throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ mutationRate: 1.5 }),
    ConfigurationError,
    "Mutation Rate",
  );
});

Deno.test("NeatOptions validation - negative mutationRate throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ mutationRate: -0.5 }),
    ConfigurationError,
    "Mutation Rate",
  );
});

Deno.test("NeatOptions validation - mutationRate 0 throws ConfigurationError", () => {
  // mutationRate must be > 0.001 (exclusive minimum)
  assertThrows(
    () => createNeatConfig({ mutationRate: 0 }),
    ConfigurationError,
    "Mutation Rate",
  );
});

Deno.test("NeatOptions validation - mutationRate 1 is valid (upper bound)", () => {
  const config = createNeatConfig({ mutationRate: 1 });
  if (config.mutationRate !== 1) {
    throw new Error(`Expected mutationRate 1, got ${config.mutationRate}`);
  }
});

Deno.test("NeatOptions validation - mutationRate 0.5 is valid", () => {
  const config = createNeatConfig({ mutationRate: 0.5 });
  if (config.mutationRate !== 0.5) {
    throw new Error(`Expected mutationRate 0.5, got ${config.mutationRate}`);
  }
});

// --- populationSize validation ---

Deno.test("NeatOptions validation - populationSize 0 throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: 0 }),
    ConfigurationError,
    "Population Size",
  );
});

Deno.test("NeatOptions validation - negative populationSize throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: -5 }),
    ConfigurationError,
    "Population Size",
  );
});

Deno.test("NeatOptions validation - populationSize 1 throws ConfigurationError", () => {
  // Minimum population is 2
  assertThrows(
    () => createNeatConfig({ populationSize: 1 }),
    ConfigurationError,
    "Population Size",
  );
});

// --- elitism < populationSize cross-field validation ---

Deno.test("NeatOptions validation - elitism >= populationSize throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: 5, elitism: 5 }),
    ConfigurationError,
    "elitism",
  );
});

Deno.test("NeatOptions validation - elitism > populationSize throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: 5, elitism: 10 }),
    ConfigurationError,
    "elitism",
  );
});

Deno.test("NeatOptions validation - elitism < populationSize is valid", () => {
  const config = createNeatConfig({ populationSize: 10, elitism: 3 });
  if (config.elitism !== 3) {
    throw new Error(`Expected elitism 3, got ${config.elitism}`);
  }
});

// --- discovery timeout validation ---

Deno.test("NeatOptions validation - discoveryAnalysisTimeoutMinutes below minimum throws", () => {
  assertThrows(
    () => createNeatConfig({ discoveryAnalysisTimeoutMinutes: 0 }),
    ConfigurationError,
    "Discovery Analysis Timeout Minutes",
  );
});

Deno.test("NeatOptions validation - discoveryAnalysisTimeoutMinutes above maximum throws", () => {
  assertThrows(
    () => createNeatConfig({ discoveryAnalysisTimeoutMinutes: 120 }),
    ConfigurationError,
    "Discovery Analysis Timeout Minutes",
  );
});

// --- WASM cache validation ---

Deno.test("NeatOptions validation - wasmCache maxCachedActivations 0 throws", () => {
  assertThrows(
    () => createNeatConfig({ wasmCache: { maxCachedActivations: 0 } }),
    ConfigurationError,
    "WASM cache maxCachedActivations",
  );
});

Deno.test("NeatOptions validation - wasmCache compilationCacheSize 0 throws", () => {
  assertThrows(
    () => createNeatConfig({ wasmCache: { compilationCacheSize: 0 } }),
    ConfigurationError,
    "WASM cache compilationCacheSize",
  );
});

// --- string coercion validation ---

Deno.test("NeatOptions validation - mutationRate as invalid string throws ConfigurationError", () => {
  assertThrows(
    () => createNeatConfig({ mutationRate: "not-a-number" }),
    ConfigurationError,
    "Mutation Rate",
  );
});

Deno.test("NeatOptions validation - populationSize as non-numeric string throws", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: "abc" }),
    ConfigurationError,
    "Population Size",
  );
});
