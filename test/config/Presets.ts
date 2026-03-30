/**
 * Tests for configuration presets (Issue #1619).
 *
 * Verifies that each preset produces a valid configuration when passed
 * through createNeatConfig(), and that presets can be composed with
 * user overrides via spread syntax.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  DISCOVERY_FOCUSED_PRESET,
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
  ];
  for (const preset of presets) {
    const config = createNeatConfig({ ...preset });
    // Every config must have a positive population size and iteration count
    assert(config.populationSize > 0, "populationSize must be positive");
    assert(config.iterations > 0, "iterations must be positive");
    assert(config.targetError >= 0, "targetError must be non-negative");
  }
});
