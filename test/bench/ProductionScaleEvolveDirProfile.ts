/**
 * Issue #2307 — Tests for production-scale creature generation.
 *
 * Validates that the `generateProductionCreature` helper produces a
 * creature with the expected production-cluster dimensions. This test is
 * purely structural (no WASM activation, no evolution) and runs fast.
 *
 * Phase timing field tests (fitnessMs, breedingMs, etc.) are covered
 * at small scale by test/config/PhaseTimingFields.ts — running those
 * at production scale in the quality suite would exceed the time budget.
 * Use bench/ProductionScaleEvolveDirProfile.ts for production-scale
 * timing measurements.
 */

import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import {
  createSeededRng,
  generateProductionCreature,
} from "../../test/propagate/large/ProductionScaleCreature.ts";

Deno.test("Production-scale creature has production-cluster dimensions", () => {
  const rng = createSeededRng(2307);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  // Production-cluster target: ~1,500 neurons, ~20,000 synapses
  assertGreater(
    creature.neurons.length,
    1_300,
    "Should have at least 1,300 neurons for production scale",
  );
  assertGreater(
    creature.synapses.length,
    15_000,
    "Should have at least 15,000 synapses for production scale",
  );
  assertEquals(
    creature.input,
    648,
    "Input count should match production-cluster scale",
  );
  assertEquals(
    creature.output,
    2,
    "Output count should match production-cluster scale",
  );
});

Deno.test("Production learn/sampler creature matches network.json dimensions (grq-3397)", () => {
  // Issue #3397: the `grq-3397` preset reproduces the production cluster's
  // `network.json` topology used by worker/learn.sh — 1,666 neurons,
  // ~21,513 synapses, 2,461 inputs — so the profiling report's command is
  // reproducible against the real production dimensions.
  const rng = createSeededRng(3396);
  const creature = generateProductionCreature(2461, 2, rng, {
    scale: "grq-3397",
  });

  // Neuron and input counts are exact and deterministic for this seed.
  assertEquals(
    creature.neurons.length,
    1666,
    "grq-3397 must produce exactly 1,666 neurons (network.json)",
  );
  assertEquals(creature.input, 2461, "Input count should match network.json");
  assertEquals(creature.output, 2, "Output count should match network.json");

  // Synapse count is close to the production 21,513 (deterministic per seed).
  assertAlmostEquals(
    creature.synapses.length,
    21_513,
    500,
    "grq-3397 synapse count should be within 500 of the production 21,513",
  );
});
