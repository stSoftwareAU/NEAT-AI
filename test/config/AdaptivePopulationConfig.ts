import { assertEquals } from "@std/assert";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "../../src/config/AdaptivePopulationConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("AdaptivePopulationConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.adaptivePopulation.enabled,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG.enabled,
  );
  assertEquals(
    config.adaptivePopulation.minPopulationFraction,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG.minPopulationFraction,
  );
  assertEquals(
    config.adaptivePopulation.maxPopulationFraction,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG.maxPopulationFraction,
  );
  assertEquals(
    config.adaptivePopulation.adjustmentRate,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG.adjustmentRate,
  );
});

Deno.test("AdaptivePopulationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    adaptivePopulation: {
      enabled: true,
      minPopulationFraction: 0.3,
      maxPopulationFraction: 3.0,
      adjustmentRate: 0.2,
    },
  });
  assertEquals(config.adaptivePopulation.enabled, true);
  assertEquals(config.adaptivePopulation.minPopulationFraction, 0.3);
  assertEquals(config.adaptivePopulation.maxPopulationFraction, 3.0);
  assertEquals(config.adaptivePopulation.adjustmentRate, 0.2);
});

Deno.test("AdaptivePopulationConfig - disabled by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.adaptivePopulation.enabled, false);
});

Deno.test("AdaptivePopulationConfig - string coercion for CLI", () => {
  const config = createNeatConfig({
    adaptivePopulation: {
      adjustmentRate: "0.15" as unknown as number,
    },
  });
  assertEquals(config.adaptivePopulation.adjustmentRate, 0.15);
});
