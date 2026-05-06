import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";

Deno.test("MCMCConfig - defaults applied when not specified", () => {
  const config = createNeatConfig({});
  assertEquals(config.mcmc.enabled, DEFAULT_MCMC_CONFIG.enabled);
  assertEquals(
    config.mcmc.initialTemperature,
    DEFAULT_MCMC_CONFIG.initialTemperature,
  );
  assertEquals(config.mcmc.minTemperature, DEFAULT_MCMC_CONFIG.minTemperature);
  assertEquals(config.mcmc.coolingRate, DEFAULT_MCMC_CONFIG.coolingRate);
  assertEquals(
    config.mcmc.targetAcceptanceRate,
    DEFAULT_MCMC_CONFIG.targetAcceptanceRate,
  );
  assertEquals(config.mcmc.adjustmentRate, DEFAULT_MCMC_CONFIG.adjustmentRate);
  assertEquals(config.mcmc.toleranceRate, DEFAULT_MCMC_CONFIG.toleranceRate);
});

Deno.test("MCMCConfig - enabled defaults to false (non-breaking)", () => {
  const config = createNeatConfig({});
  assertEquals(config.mcmc.enabled, false);
});

Deno.test("MCMCConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    mcmc: {
      enabled: true,
      initialTemperature: 2.0,
      minTemperature: 0.05,
      coolingRate: 0.99,
      targetAcceptanceRate: 0.3,
    },
  });
  assertEquals(config.mcmc.enabled, true);
  assertEquals(config.mcmc.initialTemperature, 2.0);
  assertEquals(config.mcmc.minTemperature, 0.05);
  assertEquals(config.mcmc.coolingRate, 0.99);
  assertEquals(config.mcmc.targetAcceptanceRate, 0.3);
});

Deno.test("MCMCConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    mcmc: {
      enabled: true,
    },
  });
  assertEquals(config.mcmc.enabled, true);
  assertEquals(
    config.mcmc.initialTemperature,
    DEFAULT_MCMC_CONFIG.initialTemperature,
  );
  assertEquals(config.mcmc.minTemperature, DEFAULT_MCMC_CONFIG.minTemperature);
  assertEquals(config.mcmc.coolingRate, DEFAULT_MCMC_CONFIG.coolingRate);
  assertEquals(
    config.mcmc.targetAcceptanceRate,
    DEFAULT_MCMC_CONFIG.targetAcceptanceRate,
  );
});

Deno.test("MCMCConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    mcmc: {
      initialTemperature: "2.5" as unknown as number,
      minTemperature: "0.02" as unknown as number,
      coolingRate: "0.99" as unknown as number,
      targetAcceptanceRate: "0.3" as unknown as number,
    },
  });
  assertEquals(config.mcmc.initialTemperature, 2.5);
  assertEquals(config.mcmc.minTemperature, 0.02);
  assertEquals(config.mcmc.coolingRate, 0.99);
  assertEquals(config.mcmc.targetAcceptanceRate, 0.3);
});

Deno.test("MCMCConfig - initialTemperature must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { initialTemperature: 0 },
      }),
    Error,
    "initialTemperature",
  );
});

Deno.test("MCMCConfig - negative initialTemperature rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { initialTemperature: -1 },
      }),
    Error,
    "initialTemperature",
  );
});

Deno.test("MCMCConfig - minTemperature must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { minTemperature: 0 },
      }),
    Error,
    "minTemperature",
  );
});

Deno.test("MCMCConfig - negative minTemperature rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { minTemperature: -0.01 },
      }),
    Error,
    "minTemperature",
  );
});

Deno.test("MCMCConfig - coolingRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { coolingRate: 0 },
      }),
    Error,
    "coolingRate",
  );
});

Deno.test("MCMCConfig - coolingRate must be < 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { coolingRate: 1 },
      }),
    Error,
    "coolingRate",
  );
});

Deno.test("MCMCConfig - coolingRate >= 1 rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { coolingRate: 1.5 },
      }),
    Error,
    "coolingRate",
  );
});

Deno.test("MCMCConfig - negative coolingRate rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { coolingRate: -0.5 },
      }),
    Error,
    "coolingRate",
  );
});

Deno.test("MCMCConfig - targetAcceptanceRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { targetAcceptanceRate: 0 },
      }),
    Error,
    "targetAcceptanceRate",
  );
});

Deno.test("MCMCConfig - targetAcceptanceRate must be < 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { targetAcceptanceRate: 1 },
      }),
    Error,
    "targetAcceptanceRate",
  );
});

Deno.test("MCMCConfig - minTemperature must be <= initialTemperature", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: {
          initialTemperature: 0.5,
          minTemperature: 1.0,
        },
      }),
    Error,
    "minTemperature",
  );
});

// Issue #2201: Tests for adjustmentRate and toleranceRate

Deno.test("MCMCConfig - adjustmentRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { adjustmentRate: 0 },
      }),
    Error,
    "adjustmentRate",
  );
});

Deno.test("MCMCConfig - adjustmentRate must be < 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { adjustmentRate: 1 },
      }),
    Error,
    "adjustmentRate",
  );
});

Deno.test("MCMCConfig - toleranceRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { toleranceRate: 0 },
      }),
    Error,
    "toleranceRate",
  );
});

Deno.test("MCMCConfig - toleranceRate must be < 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { toleranceRate: 1 },
      }),
    Error,
    "toleranceRate",
  );
});

Deno.test("MCMCConfig - custom adjustmentRate and toleranceRate override defaults", () => {
  const config = createNeatConfig({
    mcmc: {
      adjustmentRate: 0.05,
      toleranceRate: 0.1,
    },
  });
  assertEquals(config.mcmc.adjustmentRate, 0.05);
  assertEquals(config.mcmc.toleranceRate, 0.1);
});

Deno.test("MCMCConfig - string adjustmentRate and toleranceRate coerced from CLI", () => {
  const config = createNeatConfig({
    mcmc: {
      adjustmentRate: "0.03" as unknown as number,
      toleranceRate: "0.08" as unknown as number,
    },
  });
  assertEquals(config.mcmc.adjustmentRate, 0.03);
  assertEquals(config.mcmc.toleranceRate, 0.08);
});

// --- Issue #2527: mcmcAdvantageMode tests ---

Deno.test(
  "MCMCConfig - mcmcAdvantageMode defaults to 'absolute' (non-breaking)",
  () => {
    const config = createNeatConfig({});
    assertEquals(config.mcmc.mcmcAdvantageMode, "absolute");
    assertEquals(config.mcmc.minCohortSize, 4);
    assertEquals(config.mcmc.advantageEps, 1e-8);
    assertEquals(config.mcmc.advantageClip, 10);
  },
);

Deno.test("MCMCConfig - mcmcAdvantageMode 'groupRelative' is accepted", () => {
  const config = createNeatConfig({
    mcmc: {
      enabled: true,
      mcmcAdvantageMode: "groupRelative",
      minCohortSize: 8,
      advantageEps: 1e-6,
      advantageClip: 5,
    },
  });
  assertEquals(config.mcmc.mcmcAdvantageMode, "groupRelative");
  assertEquals(config.mcmc.minCohortSize, 8);
  assertEquals(config.mcmc.advantageEps, 1e-6);
  assertEquals(config.mcmc.advantageClip, 5);
});

Deno.test("MCMCConfig - mcmcAdvantageMode rejects unknown strings", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: {
          // deno-lint-ignore no-explicit-any
          mcmcAdvantageMode: "raw" as any,
        },
      }),
    Error,
    "mcmcAdvantageMode",
  );
});
