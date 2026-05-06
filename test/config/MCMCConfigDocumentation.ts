/**
 * Tests that verify MCMC configuration documentation accuracy.
 *
 * Issue #2210: These tests ensure the MCMC defaults documented in
 * CONFIGURATION_GUIDE.md and api/CONFIGURATION.md match the actual code,
 * and that MCMCConfig is properly exported from the public API.
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import type { MCMCConfig, RequiredMCMCConfig } from "@config/MCMCConfig.ts";

// Verify public API exports work
import { DEFAULT_MCMC_CONFIG as PUBLIC_DEFAULT } from "../../mod.ts";
import type {
  MCMCConfig as PublicMCMCConfig,
  RequiredMCMCConfig as PublicRequiredMCMCConfig,
} from "../../mod.ts";

Deno.test("MCMC documentation - defaults match CONFIGURATION_GUIDE values", () => {
  // These values are documented in docs/CONFIGURATION_GUIDE.md
  assertEquals(DEFAULT_MCMC_CONFIG.enabled, false);
  assertEquals(DEFAULT_MCMC_CONFIG.initialTemperature, 1.0);
  assertEquals(DEFAULT_MCMC_CONFIG.minTemperature, 0.01);
  assertEquals(DEFAULT_MCMC_CONFIG.coolingRate, 0.995);
  assertEquals(DEFAULT_MCMC_CONFIG.targetAcceptanceRate, 0.234);
  assertEquals(DEFAULT_MCMC_CONFIG.adjustmentRate, 0.02);
  assertEquals(DEFAULT_MCMC_CONFIG.toleranceRate, 0.05);
  // Issue #2456: Diversity-aware MCMC defaults
  assertEquals(DEFAULT_MCMC_CONFIG.diversityAwareMCMC.enabled, true);
  assertEquals(DEFAULT_MCMC_CONFIG.diversityAwareMCMC.minSpecies, 4);
  assertEquals(DEFAULT_MCMC_CONFIG.diversityAwareMCMC.crowdingThreshold, 0.85);
  assertEquals(DEFAULT_MCMC_CONFIG.diversityAwareMCMC.reheatFactor, 1.5);
});

Deno.test("MCMC documentation - public API exports match internal defaults", () => {
  // Verify mod.ts re-exports the same DEFAULT_MCMC_CONFIG
  assertEquals(PUBLIC_DEFAULT, DEFAULT_MCMC_CONFIG);
  assertEquals(PUBLIC_DEFAULT.enabled, false);
  assertEquals(PUBLIC_DEFAULT.initialTemperature, 1.0);
  assertEquals(PUBLIC_DEFAULT.coolingRate, 0.995);
  assertEquals(PUBLIC_DEFAULT.targetAcceptanceRate, 0.234);
});

Deno.test("MCMC documentation - MCMCConfig type is usable from public API", () => {
  // Verify the type is properly exported and usable
  const config: PublicMCMCConfig = {
    enabled: true,
    initialTemperature: 2.0,
  };
  assertEquals(config.enabled, true);
  assertEquals(config.initialTemperature, 2.0);
});

Deno.test("MCMC documentation - RequiredMCMCConfig type is usable from public API", () => {
  // Verify the required type is properly exported and all fields are present
  const config: PublicRequiredMCMCConfig = {
    enabled: true,
    initialTemperature: 1.5,
    minTemperature: 0.01,
    coolingRate: 0.99,
    targetAcceptanceRate: 0.234,
    adjustmentRate: 0.02,
    toleranceRate: 0.05,
    diversityAwareMCMC: {
      enabled: true,
      minSpecies: 4,
      crowdingThreshold: 0.85,
      reheatFactor: 1.5,
    },
    // Issue #2527: GRPO-style group-relative advantage signal.
    mcmcAdvantageMode: "absolute",
    minCohortSize: 4,
    advantageEps: 1e-8,
    advantageClip: 10,
  };
  assertEquals(config.enabled, true);
  assertEquals(config.initialTemperature, 1.5);
  assertEquals(config.coolingRate, 0.99);
  assertEquals(config.diversityAwareMCMC.minSpecies, 4);
});

Deno.test("MCMC documentation - internal and public types are compatible", () => {
  // Verify the internal and public types are the same
  const internal: MCMCConfig = { enabled: true };
  const external: PublicMCMCConfig = internal;
  assertEquals(external.enabled, true);

  const internalRequired: RequiredMCMCConfig = { ...DEFAULT_MCMC_CONFIG };
  const externalRequired: PublicRequiredMCMCConfig = internalRequired;
  assertEquals(externalRequired.enabled, DEFAULT_MCMC_CONFIG.enabled);
});
