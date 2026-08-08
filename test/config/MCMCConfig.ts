import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import type { NeatOptionsInput } from "@config/NeatOptions.ts";

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

/** One rejected `mcmc` block and the field its error message must name. */
type MCMCRejectionCase = {
  /** Step name describing the rule under test. */
  readonly scenario: string;
  /** The `mcmc` block handed to `createNeatConfig`. */
  readonly mcmc: NonNullable<NeatOptionsInput["mcmc"]>;
  /** Substring the thrown message must contain (the offending field). */
  readonly field: string;
};

/**
 * Every invalid `mcmc` value `createNeatConfig` must reject. Table-driven
 * (Issue #3677) so a new rule is one row, and tightening a message is one
 * assertion site. Covers Issue #2201 (adjustmentRate / toleranceRate) and
 * Issue #2527 (mcmcAdvantageMode).
 */
const MCMC_REJECTION_CASES: readonly MCMCRejectionCase[] = [
  {
    scenario: "initialTemperature must be > 0",
    mcmc: { initialTemperature: 0 },
    field: "initialTemperature",
  },
  {
    scenario: "negative initialTemperature rejected",
    mcmc: { initialTemperature: -1 },
    field: "initialTemperature",
  },
  {
    scenario: "minTemperature must be > 0",
    mcmc: { minTemperature: 0 },
    field: "minTemperature",
  },
  {
    scenario: "negative minTemperature rejected",
    mcmc: { minTemperature: -0.01 },
    field: "minTemperature",
  },
  {
    scenario: "coolingRate must be > 0",
    mcmc: { coolingRate: 0 },
    field: "coolingRate",
  },
  {
    scenario: "coolingRate must be < 1",
    mcmc: { coolingRate: 1 },
    field: "coolingRate",
  },
  {
    scenario: "coolingRate >= 1 rejected",
    mcmc: { coolingRate: 1.5 },
    field: "coolingRate",
  },
  {
    scenario: "negative coolingRate rejected",
    mcmc: { coolingRate: -0.5 },
    field: "coolingRate",
  },
  {
    scenario: "targetAcceptanceRate must be > 0",
    mcmc: { targetAcceptanceRate: 0 },
    field: "targetAcceptanceRate",
  },
  {
    scenario: "targetAcceptanceRate must be < 1",
    mcmc: { targetAcceptanceRate: 1 },
    field: "targetAcceptanceRate",
  },
  {
    scenario: "minTemperature must be <= initialTemperature",
    mcmc: { initialTemperature: 0.5, minTemperature: 1.0 },
    field: "minTemperature",
  },
  // Issue #2201: adjustmentRate and toleranceRate
  {
    scenario: "adjustmentRate must be > 0",
    mcmc: { adjustmentRate: 0 },
    field: "adjustmentRate",
  },
  {
    scenario: "adjustmentRate must be < 1",
    mcmc: { adjustmentRate: 1 },
    field: "adjustmentRate",
  },
  {
    scenario: "toleranceRate must be > 0",
    mcmc: { toleranceRate: 0 },
    field: "toleranceRate",
  },
  {
    scenario: "toleranceRate must be < 1",
    mcmc: { toleranceRate: 1 },
    field: "toleranceRate",
  },
  // Issue #2527: mcmcAdvantageMode
  {
    scenario: "mcmcAdvantageMode rejects unknown strings",
    // deno-lint-ignore no-explicit-any
    mcmc: { mcmcAdvantageMode: "raw" as any },
    field: "mcmcAdvantageMode",
  },
];

for (const rejection of MCMC_REJECTION_CASES) {
  Deno.test(`MCMCConfig - ${rejection.scenario}`, () => {
    assertThrows(
      () => createNeatConfig({ mcmc: rejection.mcmc }),
      Error,
      rejection.field,
    );
  });
}

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
