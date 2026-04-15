/**
 * Issue #2307 — Tests for production-scale creature generation.
 *
 * Validates that the `generateProductionCreature` helper produces a
 * creature with the expected GRQ-cluster dimensions. This test is
 * purely structural (no WASM activation, no evolution) and runs fast.
 *
 * Phase timing field tests (fitnessMs, breedingMs, etc.) are covered
 * at small scale by test/config/PhaseTimingFields.ts — running those
 * at production scale in the quality suite would exceed the time budget.
 * Use bench/ProductionScaleEvolveDirProfile.ts for production-scale
 * timing measurements.
 */

import { assertEquals, assertGreater } from "@std/assert";
import {
  createSeededRng,
  generateProductionCreature,
} from "../../test/propagate/large/ProductionScaleCreature.ts";

Deno.test("Production-scale creature has GRQ-cluster dimensions", () => {
  const rng = createSeededRng(2307);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  // GRQ-cluster target: ~1,500 neurons, ~20,000 synapses
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
  assertEquals(creature.input, 648, "Input count should match GRQ-cluster");
  assertEquals(creature.output, 2, "Output count should match GRQ-cluster");
});
