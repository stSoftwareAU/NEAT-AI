/**
 * Evolution-control configuration resolution (Issue #3931).
 *
 * The policy decides how often a run re-anchors on ground truth, so a knob
 * silently corrected into range would change that cadence without saying so.
 * Every invalid value is rejected here, never clamped.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_EVOLUTION_CONTROL_CONFIG,
  EVOLUTION_CONTROL_STRATEGIES,
  type EvolutionControlConfig,
  resolveEvolutionControlConfig,
} from "@config/EvolutionControlConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

Deno.test("evolution control config — defaults leave the policy off", () => {
  const resolved = resolveEvolutionControlConfig();
  assertEquals(resolved, DEFAULT_EVOLUTION_CONTROL_CONFIG);
  assertEquals(resolved.strategy, "none");
});

Deno.test("evolution control config — an override replaces only the field given", () => {
  const resolved = resolveEvolutionControlConfig({
    strategy: "generation",
    exactEvery: 7,
  });
  assertEquals(resolved.strategy, "generation");
  assertEquals(resolved.exactEvery, 7);
  assertEquals(resolved.exactTopK, DEFAULT_EVOLUTION_CONTROL_CONFIG.exactTopK);
  assertEquals(
    resolved.canaryThreshold,
    DEFAULT_EVOLUTION_CONTROL_CONFIG.canaryThreshold,
  );
});

Deno.test("evolution control config — every named strategy resolves", () => {
  for (const strategy of EVOLUTION_CONTROL_STRATEGIES) {
    assertEquals(
      resolveEvolutionControlConfig({ strategy }).strategy,
      strategy,
    );
  }
});

Deno.test("evolution control config — invalid values are rejected, never clamped", () => {
  const cases: [EvolutionControlConfig, string][] = [
    [{ strategy: "population" as never }, "strategy"],
    [{ exactEvery: 1 }, "exactEvery"],
    [{ exactEvery: 2.5 }, "exactEvery"],
    [{ exactEvery: Number.NaN }, "exactEvery"],
    [{ exactTopK: 0 }, "exactTopK"],
    [{ diverseSampleSize: -1 }, "diverseSampleSize"],
    [{ canaryWindow: 1 }, "canaryWindow"],
    [{ canaryThreshold: 0 }, "canaryThreshold"],
    [{ canaryThreshold: 1.5 }, "canaryThreshold"],
    [{ canaryThreshold: Number.POSITIVE_INFINITY }, "canaryThreshold"],
  ];
  for (const [config, field] of cases) {
    const error = assertThrows(
      () => resolveEvolutionControlConfig(config),
      ConfigurationError,
      undefined,
      `${field} must be rejected`,
    );
    assert(error.message.includes(field), error.message);
  }
});
