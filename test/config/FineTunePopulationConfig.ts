import {
  assertEquals,
  assertGreater,
  assertLessOrEqual,
  assertThrows,
} from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_FINE_TUNE_POPULATION_CONFIG } from "../../src/config/FineTunePopulationConfig.ts";

Deno.test(
  "FineTunePopulationConfig - defaults applied when not specified",
  () => {
    const config = createNeatConfig({});
    assertEquals(
      config.fineTunePopulation.minPopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.minPopulationFraction,
    );
    assertEquals(
      config.fineTunePopulation.maxPopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.maxPopulationFraction,
    );
    assertEquals(
      config.fineTunePopulation.basePopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.basePopulationFraction,
    );
    assertEquals(
      config.fineTunePopulation.successRateWindow,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.successRateWindow,
    );
  },
);

Deno.test(
  "FineTunePopulationConfig - custom values override defaults",
  () => {
    const config = createNeatConfig({
      fineTunePopulation: {
        minPopulationFraction: 0.05,
        maxPopulationFraction: 0.5,
        basePopulationFraction: 0.25,
        successRateWindow: 20,
      },
    });
    assertEquals(config.fineTunePopulation.minPopulationFraction, 0.05);
    assertEquals(config.fineTunePopulation.maxPopulationFraction, 0.5);
    assertEquals(config.fineTunePopulation.basePopulationFraction, 0.25);
    assertEquals(config.fineTunePopulation.successRateWindow, 20);
  },
);

Deno.test(
  "FineTunePopulationConfig - partial overrides merge with defaults",
  () => {
    const config = createNeatConfig({
      fineTunePopulation: {
        successRateWindow: 5,
      },
    });
    assertEquals(
      config.fineTunePopulation.minPopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.minPopulationFraction,
    );
    assertEquals(
      config.fineTunePopulation.maxPopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.maxPopulationFraction,
    );
    assertEquals(
      config.fineTunePopulation.basePopulationFraction,
      DEFAULT_FINE_TUNE_POPULATION_CONFIG.basePopulationFraction,
    );
    assertEquals(config.fineTunePopulation.successRateWindow, 5);
  },
);

Deno.test(
  "FineTunePopulationConfig - string values coerced from CLI",
  () => {
    const config = createNeatConfig({
      fineTunePopulation: {
        minPopulationFraction: "0.05" as unknown as number,
        maxPopulationFraction: "0.5" as unknown as number,
        basePopulationFraction: "0.25" as unknown as number,
        successRateWindow: "20" as unknown as number,
      },
    });
    assertEquals(config.fineTunePopulation.minPopulationFraction, 0.05);
    assertEquals(config.fineTunePopulation.maxPopulationFraction, 0.5);
    assertEquals(config.fineTunePopulation.basePopulationFraction, 0.25);
    assertEquals(config.fineTunePopulation.successRateWindow, 20);
  },
);

Deno.test(
  "FineTunePopulationConfig - maxPopulationFraction less than minPopulationFraction throws",
  () => {
    assertThrows(
      () =>
        createNeatConfig({
          fineTunePopulation: {
            minPopulationFraction: 0.5,
            maxPopulationFraction: 0.1,
          },
        }),
      Error,
      "maxPopulationFraction must be >= minPopulationFraction",
    );
  },
);

Deno.test(
  "FineTunePopulationConfig - basePopulationFraction below min throws",
  () => {
    assertThrows(
      () =>
        createNeatConfig({
          fineTunePopulation: {
            minPopulationFraction: 0.3,
            basePopulationFraction: 0.1,
          },
        }),
      Error,
      "basePopulationFraction must be >= minPopulationFraction",
    );
  },
);

Deno.test(
  "FineTunePopulationConfig - basePopulationFraction above max throws",
  () => {
    assertThrows(
      () =>
        createNeatConfig({
          fineTunePopulation: {
            maxPopulationFraction: 0.2,
            basePopulationFraction: 0.3,
          },
        }),
      Error,
      "basePopulationFraction must be <= maxPopulationFraction",
    );
  },
);

Deno.test("FineTunePopulationConfig - default values are sensible", () => {
  const d = DEFAULT_FINE_TUNE_POPULATION_CONFIG;
  assertGreater(d.minPopulationFraction, 0);
  assertLessOrEqual(d.minPopulationFraction, 1);
  assertGreater(d.maxPopulationFraction, 0);
  assertLessOrEqual(d.maxPopulationFraction, 1);
  assertGreater(d.maxPopulationFraction, d.minPopulationFraction);
  assertGreater(d.basePopulationFraction, 0);
  assertLessOrEqual(d.basePopulationFraction, d.maxPopulationFraction);
  assertGreater(d.basePopulationFraction, d.minPopulationFraction - 0.001);
  assertGreater(d.successRateWindow, 0);
});
