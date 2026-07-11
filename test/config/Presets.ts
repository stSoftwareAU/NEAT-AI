/**
 * Tests for configuration presets (Issue #1619).
 *
 * Verifies that each preset produces a valid configuration when passed
 * through createNeatConfig(), and that presets can be composed with
 * user overrides via spread syntax.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_DISCOVERY_SAMPLE_RATE,
} from "@config/NeatConfig.ts";
import {
  DISCOVERY_FOCUSED_PRESET,
  FAST_CONVERGENCE_PRESET,
  LARGE_NETWORK_PRESET,
  MEMORY_CONSTRAINED_PRESET,
  QUICK_START_PRESET,
} from "@presets/Presets.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";

// ─── Quick Start preset ───────────────────────────────────────────

Deno.test("Quick Start preset - produces valid configuration", () => {
  const config = createNeatConfig({ ...QUICK_START_PRESET });
  assertEquals(config.populationSize, QUICK_START_PRESET.populationSize);
  assertEquals(config.targetError, QUICK_START_PRESET.targetError);
  assertEquals(config.iterations, QUICK_START_PRESET.iterations);
});

Deno.test("Quick Start preset - discovery is disabled", () => {
  const config = createNeatConfig({ ...QUICK_START_PRESET });
  assertEquals(config.discoverySampleRate, -1);
});

Deno.test("Quick Start preset - user overrides take precedence", () => {
  const config = createNeatConfig({
    ...QUICK_START_PRESET,
    populationSize: 25,
    targetError: 0.02,
  });
  assertEquals(config.populationSize, 25);
  assertEquals(config.targetError, 0.02);
  // Non-overridden values remain from preset
  assertEquals(config.iterations, QUICK_START_PRESET.iterations);
});

// ─── Large Network preset ─────────────────────────────────────────

Deno.test("Large Network preset - produces valid configuration", () => {
  const config = createNeatConfig({ ...LARGE_NETWORK_PRESET });
  assertEquals(config.populationSize, LARGE_NETWORK_PRESET.populationSize);
  assertEquals(config.targetError, LARGE_NETWORK_PRESET.targetError);
});

Deno.test("Large Network preset - discovery is enabled", () => {
  const config = createNeatConfig({ ...LARGE_NETWORK_PRESET });
  assertNotEquals(config.discoverySampleRate, -1);
});

Deno.test("Large Network preset - plateau detection is enabled", () => {
  const config = createNeatConfig({ ...LARGE_NETWORK_PRESET });
  assertEquals(config.plateauDetection.enabled, true);
});

Deno.test("Large Network preset - user overrides take precedence", () => {
  const config = createNeatConfig({
    ...LARGE_NETWORK_PRESET,
    populationSize: 50,
  });
  assertEquals(config.populationSize, 50);
});

// ─── Memory Constrained preset ────────────────────────────────────

Deno.test("Memory Constrained preset - produces valid configuration", () => {
  const config = createNeatConfig({ ...MEMORY_CONSTRAINED_PRESET });
  assertEquals(
    config.populationSize,
    MEMORY_CONSTRAINED_PRESET.populationSize,
  );
});

Deno.test("Memory Constrained preset - has conservative thread count", () => {
  const config = createNeatConfig({ ...MEMORY_CONSTRAINED_PRESET });
  assertEquals(config.threads, MEMORY_CONSTRAINED_PRESET.threads);
});

Deno.test("Memory Constrained preset - discovery is disabled", () => {
  const config = createNeatConfig({ ...MEMORY_CONSTRAINED_PRESET });
  assertEquals(config.discoverySampleRate, -1);
});

Deno.test("Memory Constrained preset - user overrides take precedence", () => {
  const config = createNeatConfig({
    ...MEMORY_CONSTRAINED_PRESET,
    threads: 4,
  });
  assertEquals(config.threads, 4);
});

// ─── Discovery Focused preset ─────────────────────────────────────

Deno.test("Discovery Focused preset - produces valid configuration", () => {
  const config = createNeatConfig({ ...DISCOVERY_FOCUSED_PRESET });
  assertEquals(
    config.populationSize,
    DISCOVERY_FOCUSED_PRESET.populationSize,
  );
});

Deno.test("Discovery Focused preset - has higher sample rate", () => {
  const config = createNeatConfig({ ...DISCOVERY_FOCUSED_PRESET });
  assertNotEquals(config.discoverySampleRate, -1);
  // The preset should have a higher discovery sample rate than default 0.2
  assertEquals(
    config.discoverySampleRate,
    DISCOVERY_FOCUSED_PRESET.discoverySampleRate,
  );
});

Deno.test("Discovery Focused preset - has longer timeouts", () => {
  const config = createNeatConfig({ ...DISCOVERY_FOCUSED_PRESET });
  assertEquals(
    config.discoveryRecordTimeOutMinutes,
    DISCOVERY_FOCUSED_PRESET.discoveryRecordTimeOutMinutes,
  );
  assertEquals(
    config.discoveryAnalysisTimeoutMinutes,
    DISCOVERY_FOCUSED_PRESET.discoveryAnalysisTimeoutMinutes,
  );
});

Deno.test("Discovery Focused preset - user overrides take precedence", () => {
  const config = createNeatConfig({
    ...DISCOVERY_FOCUSED_PRESET,
    discoverySampleRate: 0.1,
  });
  assertEquals(config.discoverySampleRate, 0.1);
});

// ─── Fast Convergence preset ──────────────────────────────────────

Deno.test("Fast Convergence preset - produces valid configuration", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assertEquals(
    config.populationSize,
    FAST_CONVERGENCE_PRESET.populationSize,
  );
  assertEquals(config.targetError, FAST_CONVERGENCE_PRESET.targetError);
  assertEquals(config.iterations, FAST_CONVERGENCE_PRESET.iterations);
});

Deno.test("Fast Convergence preset - discovery stays at the default sample rate", () => {
  // The preset deliberately does NOT set discoverySampleRate, so config
  // resolution falls through to DEFAULT_DISCOVERY_SAMPLE_RATE (0.2 / 20%).
  // Discovery is therefore ENABLED for this preset (Issue #3272) — the docs
  // table must reflect 20%, not "Disabled".
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assertEquals(config.discoverySampleRate, DEFAULT_DISCOVERY_SAMPLE_RATE);
  assertNotEquals(config.discoverySampleRate, -1);
  assert(
    config.discoverySampleRate > 0,
    "discovery must be active (rate > 0) for the Fast Convergence preset",
  );
});

Deno.test("Fast Convergence preset - plateau detection is enabled", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assertEquals(config.plateauDetection.enabled, true);
});

Deno.test("Fast Convergence preset - adaptive population is enabled", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assertEquals(config.adaptivePopulation.enabled, true);
});

Deno.test("Fast Convergence preset - species stagnation is enabled", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assertEquals(config.speciesStagnation.enabled, true);
});

Deno.test("Fast Convergence preset - stall response boosts mutation", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  // The plateau response must amplify mutation (>= 2x) to escape stalls.
  assert(
    config.plateauDetection.responseMutationMultiplier >= 2,
    "responseMutationMultiplier should be >= 2 to escape plateaus",
  );
});

Deno.test("Fast Convergence preset - leaves trainPerGen to supervised auto-scaling", () => {
  // The preset deliberately does NOT pin trainPerGen so the supervised
  // auto-scaling (round(populationSize * 0.2), Issue #2791) applies. For
  // the preset's population of 50 with the default MSE cost that resolves
  // to 10 — far more than a small hard-coded literal would give.
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assert(
    config.trainPerGen >= 2,
    "auto-scaled trainPerGen should be >= 2 for supervised convergence",
  );
});

Deno.test("Fast Convergence preset - preserves elitism", () => {
  const config = createNeatConfig({ ...FAST_CONVERGENCE_PRESET });
  assert(
    config.elitism >= 2,
    "elitism should be >= 2 to retain the best performers",
  );
});

Deno.test("Fast Convergence preset - user overrides take precedence", () => {
  const config = createNeatConfig({
    ...FAST_CONVERGENCE_PRESET,
    populationSize: 33,
  });
  assertEquals(config.populationSize, 33);
  // Non-overridden values remain from the preset.
  assertEquals(config.iterations, FAST_CONVERGENCE_PRESET.iterations);
});

// ─── Preset composition ───────────────────────────────────────────

Deno.test("Presets can be composed - memory constrained with discovery focus overrides", () => {
  const composed: NeatOptions = {
    ...MEMORY_CONSTRAINED_PRESET,
    ...DISCOVERY_FOCUSED_PRESET,
    threads: 2, // Keep limited threads from memory-constrained thinking
  };
  const config = createNeatConfig(composed);
  assertEquals(config.threads, 2);
  // Discovery settings from DISCOVERY_FOCUSED_PRESET
  assertEquals(
    config.discoverySampleRate,
    DISCOVERY_FOCUSED_PRESET.discoverySampleRate,
  );
});

Deno.test("Presets satisfy NeatOptions type and produce valid configs", () => {
  // Verify each preset produces a config with required fields populated
  const presets: NeatOptions[] = [
    QUICK_START_PRESET,
    LARGE_NETWORK_PRESET,
    MEMORY_CONSTRAINED_PRESET,
    DISCOVERY_FOCUSED_PRESET,
    FAST_CONVERGENCE_PRESET,
  ];
  for (const preset of presets) {
    const config = createNeatConfig({ ...preset });
    // Every config must have a positive population size and iteration count
    assert(config.populationSize > 0, "populationSize must be positive");
    assert(config.iterations > 0, "iterations must be positive");
    assert(config.targetError >= 0, "targetError must be non-negative");
  }
});
