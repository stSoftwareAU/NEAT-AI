/**
 * Surrogate uncertainty configuration (Issue #3933).
 *
 * Invalid values are rejected, never clamped: a silently corrected uncertainty
 * floor would let a run report an allocation fraction it never honoured, which
 * is the failure the whole guard exists to make visible.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  ACQUISITION_RULES,
  DEFAULT_SURROGATE_UNCERTAINTY_CONFIG,
  resolveSurrogateUncertaintyConfig,
} from "@config/SurrogateUncertaintyConfig.ts";
import { resolvePreSelectionConfig } from "@config/PreSelectionConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

Deno.test("uncertainty config — the guard is on by default", () => {
  const config = resolveSurrogateUncertaintyConfig();
  assertEquals(config.enabled, true);
  assertEquals(config.acquisition, "ei");
  assertEquals(config, DEFAULT_SURROGATE_UNCERTAINTY_CONFIG);
  // The floor is what costs exact evaluations, so it must not default to zero.
  assertEquals(config.minUncertaintyFraction > 0, true);
});

Deno.test("uncertainty config — both acquisition rules resolve", () => {
  for (const acquisition of ACQUISITION_RULES) {
    assertEquals(
      resolveSurrogateUncertaintyConfig({ acquisition }).acquisition,
      acquisition,
    );
  }
});

Deno.test("uncertainty config — CLI strings are parsed, not refused", () => {
  const config = resolveSurrogateUncertaintyConfig(
    {
      kappa: "2.5",
      minUncertaintyFraction: "0.4",
      driftGenerations: "7",
    } as unknown as Parameters<typeof resolveSurrogateUncertaintyConfig>[0],
  );
  assertEquals(config.kappa, 2.5);
  assertEquals(config.minUncertaintyFraction, 0.4);
  assertEquals(config.driftGenerations, 7);
});

Deno.test("uncertainty config — an unknown acquisition rule fails loud", () => {
  const error = assertThrows(
    () =>
      resolveSurrogateUncertaintyConfig(
        { acquisition: "argmax" } as unknown as Parameters<
          typeof resolveSurrogateUncertaintyConfig
        >[0],
      ),
    ConfigurationError,
  );
  assertEquals(error.reason, "INVALID_TYPE");
});

Deno.test("uncertainty config — an all-exploration floor is refused", () => {
  // 1 leaves no acquisition rule in the allocation at all, which is a
  // different policy wearing this one's diagnostics.
  const error = assertThrows(
    () => resolveSurrogateUncertaintyConfig({ minUncertaintyFraction: 1 }),
    ConfigurationError,
  );
  assertEquals(error.reason, "OUT_OF_RANGE");
  assertThrows(
    () => resolveSurrogateUncertaintyConfig({ minUncertaintyFraction: -0.1 }),
    ConfigurationError,
  );
});

Deno.test("uncertainty config — out-of-range knobs are rejected, never clamped", () => {
  const cases: Parameters<typeof resolveSurrogateUncertaintyConfig>[0][] = [
    { kappa: -1 },
    { kappa: 11 },
    { coverageQuantile: 0 },
    { coverageQuantile: 1.5 },
    { coverageFactor: 0.5 },
    { coverageMargin: -0.1 },
    { driftBiasRatio: 0 },
    { driftBiasRatio: 1.5 },
    { driftGenerations: 0 },
    { driftGenerations: 2.5 },
    { driftMinSamples: 1 },
  ];
  for (const overrides of cases) {
    assertThrows(
      () => resolveSurrogateUncertaintyConfig(overrides),
      ConfigurationError,
      undefined,
      `expected ${JSON.stringify(overrides)} to be refused`,
    );
  }
});

Deno.test("uncertainty config — pre-selection resolves it as a nested key", () => {
  const config = resolvePreSelectionConfig({
    ratio: 3,
    screen: "surrogate",
    uncertainty: { acquisition: "lcb", minUncertaintyFraction: 0.35 },
  });
  assertEquals(config.uncertainty.acquisition, "lcb");
  assertEquals(config.uncertainty.minUncertaintyFraction, 0.35);
  assertEquals(config.uncertainty.enabled, true);
  // The default stage still carries the guard on, so a caller that turns the
  // screen on later does not inherit an argmax.
  assertEquals(resolvePreSelectionConfig().uncertainty.enabled, true);
});

Deno.test("uncertainty config — a bad nested value fails the whole resolve", () => {
  assertThrows(
    () =>
      resolvePreSelectionConfig({
        ratio: 3,
        screen: "surrogate",
        uncertainty: { minUncertaintyFraction: 2 },
      }),
    ConfigurationError,
  );
});
