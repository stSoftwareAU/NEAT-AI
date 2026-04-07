/**
 * Tests for MCMCDiagnostics - acceptance rate tracking and adaptive temperature tuning.
 *
 * Issue #2201: Add MCMC acceptance rate tracking and adaptive temperature tuning.
 */

import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertLessOrEqual,
} from "@std/assert";
import { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";

/** Helper to create diagnostics with custom config. */
function createDiagnostics(
  overrides: Partial<RequiredMCMCConfig> = {},
): MCMCDiagnostics {
  return new MCMCDiagnostics({
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    ...overrides,
  });
}

// ── Acceptance rate calculation ──────────────────────────────────────

Deno.test("MCMCDiagnostics: acceptance rate with no decisions is 0", () => {
  const diag = createDiagnostics();
  assertEquals(diag.getAcceptanceRate(), 0);
});

Deno.test("MCMCDiagnostics: acceptance rate tracks accepted decisions", () => {
  const diag = createDiagnostics();
  diag.recordDecision(true);
  diag.recordDecision(true);
  diag.recordDecision(false);
  diag.recordDecision(false);

  // 2 accepted out of 4 = 50%
  assertAlmostEquals(diag.getAcceptanceRate(), 0.5, 1e-10);
});

Deno.test("MCMCDiagnostics: 100% acceptance rate", () => {
  const diag = createDiagnostics();
  for (let i = 0; i < 10; i++) {
    diag.recordDecision(true);
  }
  assertAlmostEquals(diag.getAcceptanceRate(), 1.0, 1e-10);
});

Deno.test("MCMCDiagnostics: 0% acceptance rate", () => {
  const diag = createDiagnostics();
  for (let i = 0; i < 10; i++) {
    diag.recordDecision(false);
  }
  assertAlmostEquals(diag.getAcceptanceRate(), 0.0, 1e-10);
});

// ── Generation stats ─────────────────────────────────────────────────

Deno.test("MCMCDiagnostics: getGenerationStats returns correct counts", () => {
  const diag = createDiagnostics();
  diag.recordDecision(true);
  diag.recordDecision(true);
  diag.recordDecision(true);
  diag.recordDecision(false);
  diag.recordDecision(false);

  const stats = diag.getGenerationStats();
  assertEquals(stats.proposedCount, 5);
  assertEquals(stats.acceptedCount, 3);
  assertEquals(stats.rejectedCount, 2);
  assertAlmostEquals(stats.acceptanceRate, 0.6, 1e-10);
});

// ── Rolling window smoothing ─────────────────────────────────────────

Deno.test("MCMCDiagnostics: rolling window smooths across generations", () => {
  const diag = createDiagnostics();

  // Generation 1: 100% acceptance
  for (let i = 0; i < 10; i++) {
    diag.recordDecision(true);
  }
  diag.finaliseGeneration();

  // Generation 2: 0% acceptance
  for (let i = 0; i < 10; i++) {
    diag.recordDecision(false);
  }
  diag.finaliseGeneration();

  // Smoothed rate should be average of 1.0 and 0.0 = 0.5
  assertAlmostEquals(diag.getSmoothedAcceptanceRate(), 0.5, 1e-10);
});

Deno.test("MCMCDiagnostics: rolling window respects window size", () => {
  // Use a window of 3 generations
  const diag = createDiagnostics();

  // Fill 5 generations — only the last 10 (default window) should matter
  for (let gen = 0; gen < 5; gen++) {
    for (let i = 0; i < 10; i++) {
      diag.recordDecision(gen < 3); // first 3 gens: accept, last 2: reject
    }
    diag.finaliseGeneration();
  }

  // All 5 generations fit in default window (10), so smoothed = 3/5 = 0.6
  assertAlmostEquals(diag.getSmoothedAcceptanceRate(), 0.6, 1e-10);
});

Deno.test("MCMCDiagnostics: smoothed rate only uses recent window", () => {
  const diag = createDiagnostics();

  // Fill more than 10 generations (default window)
  // First 5: 100% acceptance
  for (let gen = 0; gen < 5; gen++) {
    for (let i = 0; i < 10; i++) {
      diag.recordDecision(true);
    }
    diag.finaliseGeneration();
  }
  // Next 10: 0% acceptance — these fill the window
  for (let gen = 0; gen < 10; gen++) {
    for (let i = 0; i < 10; i++) {
      diag.recordDecision(false);
    }
    diag.finaliseGeneration();
  }

  // Window of 10 should only see the last 10 generations (all 0%)
  assertAlmostEquals(diag.getSmoothedAcceptanceRate(), 0.0, 1e-10);
});

// ── Adaptive temperature tuning ──────────────────────────────────────

Deno.test("MCMCDiagnostics: temperature decreases when acceptance rate too high", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 1.0,
    minTemperature: 0.01,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  // Record high acceptance rate (80%)
  for (let i = 0; i < 80; i++) diag.recordDecision(true);
  for (let i = 0; i < 20; i++) diag.recordDecision(false);
  diag.finaliseGeneration();

  // Adaptive tuning should decrease temperature
  const adjusted = diag.adaptTemperature(1.0);
  assertLess(adjusted, 1.0);
});

Deno.test("MCMCDiagnostics: temperature increases when acceptance rate too low", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 1.0,
    minTemperature: 0.01,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  // Record low acceptance rate (5%)
  for (let i = 0; i < 5; i++) diag.recordDecision(true);
  for (let i = 0; i < 95; i++) diag.recordDecision(false);
  diag.finaliseGeneration();

  // Adaptive tuning should increase temperature
  const adjusted = diag.adaptTemperature(0.5);
  assertGreater(adjusted, 0.5);
});

Deno.test("MCMCDiagnostics: temperature unchanged when acceptance rate within tolerance", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 1.0,
    minTemperature: 0.01,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  // Record acceptance rate close to target (23%)
  for (let i = 0; i < 23; i++) diag.recordDecision(true);
  for (let i = 0; i < 77; i++) diag.recordDecision(false);
  diag.finaliseGeneration();

  const adjusted = diag.adaptTemperature(0.5);
  // Within tolerance of 0.05, so unchanged
  assertAlmostEquals(adjusted, 0.5, 1e-10);
});

// ── Temperature clamping ─────────────────────────────────────────────

Deno.test("MCMCDiagnostics: temperature clamped at minTemperature", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 1.0,
    minTemperature: 0.05,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  // Very high acceptance rate to push temperature down
  for (let i = 0; i < 100; i++) diag.recordDecision(true);
  diag.finaliseGeneration();

  // Start from a very low temperature
  const adjusted = diag.adaptTemperature(0.05);
  // Should not go below minTemperature
  assertLessOrEqual(config.minTemperature, adjusted);
});

Deno.test("MCMCDiagnostics: temperature clamped at initialTemperature", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 1.0,
    minTemperature: 0.01,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  // Very low acceptance rate to push temperature up
  for (let i = 0; i < 100; i++) diag.recordDecision(false);
  diag.finaliseGeneration();

  // Start from initial temperature
  const adjusted = diag.adaptTemperature(1.0);
  // Should not exceed initialTemperature
  assertLessOrEqual(adjusted, config.initialTemperature);
});

// ── No-op when disabled ──────────────────────────────────────────────

Deno.test("MCMCDiagnostics: no-op when mcmc.enabled is false", () => {
  const diag = new MCMCDiagnostics({
    ...DEFAULT_MCMC_CONFIG,
    enabled: false,
  });

  // Recording should not throw
  diag.recordDecision(true);
  diag.recordDecision(false);
  diag.finaliseGeneration();

  // Should return defaults
  assertEquals(diag.getAcceptanceRate(), 0);
  assertEquals(diag.getSmoothedAcceptanceRate(), 0);

  const stats = diag.getGenerationStats();
  assertEquals(stats.proposedCount, 0);
  assertEquals(stats.acceptedCount, 0);
  assertEquals(stats.rejectedCount, 0);
  assertEquals(stats.acceptanceRate, 0);

  // adaptTemperature should return temperature unchanged
  const temp = diag.adaptTemperature(0.75);
  assertAlmostEquals(temp, 0.75, 1e-10);
});

// ── Finalise resets current generation ────────────────────────────────

Deno.test("MCMCDiagnostics: finaliseGeneration resets current generation counts", () => {
  const diag = createDiagnostics();

  diag.recordDecision(true);
  diag.recordDecision(false);
  diag.finaliseGeneration();

  // After finalisation, current generation should be empty
  const stats = diag.getGenerationStats();
  assertEquals(stats.proposedCount, 0);
  assertEquals(stats.acceptedCount, 0);
  assertEquals(stats.rejectedCount, 0);
  assertEquals(stats.acceptanceRate, 0);
});

// ── Multiple adaptive adjustments converge ───────────────────────────

Deno.test("MCMCDiagnostics: repeated adaptive tuning converges temperature", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
    initialTemperature: 2.0,
    minTemperature: 0.01,
    targetAcceptanceRate: 0.234,
  };
  const diag = new MCMCDiagnostics(config);

  let temp = 2.0;

  // Simulate 50 generations with consistently high acceptance
  for (let gen = 0; gen < 50; gen++) {
    for (let i = 0; i < 80; i++) diag.recordDecision(true);
    for (let i = 0; i < 20; i++) diag.recordDecision(false);
    diag.finaliseGeneration();
    temp = diag.adaptTemperature(temp);
  }

  // After many generations of high acceptance, temperature should have decreased
  assertLess(temp, 2.0);
  // But should still be above min
  assertLessOrEqual(config.minTemperature, temp);
});
