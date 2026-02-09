import { assertEquals } from "@std/assert";
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
} from "../../src/config/EnsembleDiversityConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("EnsembleDiversityConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.ensembleDiversity.enabled,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.enabled,
  );
  assertEquals(
    config.ensembleDiversity.diversityWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.diversityWeight,
  );
  assertEquals(
    config.ensembleDiversity.weightVarianceWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.weightVarianceWeight,
  );
  assertEquals(
    config.ensembleDiversity.squashEntropyWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.squashEntropyWeight,
  );
  assertEquals(
    config.ensembleDiversity.topologyDiversityWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.topologyDiversityWeight,
  );
  assertEquals(
    config.ensembleDiversity.protectDiverseLowPerformers,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.protectDiverseLowPerformers,
  );
  assertEquals(
    config.ensembleDiversity.diversityProtectionThreshold,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.diversityProtectionThreshold,
  );
  assertEquals(
    config.ensembleDiversity.crossSpeciesBreedingThreshold,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.crossSpeciesBreedingThreshold,
  );
  assertEquals(
    config.ensembleDiversity.lowDiversityThreshold,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.lowDiversityThreshold,
  );
  assertEquals(
    config.ensembleDiversity.diverseParentPreferenceWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.diverseParentPreferenceWeight,
  );
});

Deno.test("EnsembleDiversityConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    ensembleDiversity: {
      enabled: true,
      diversityWeight: 0.5,
      squashEntropyWeight: 0.1,
      protectDiverseLowPerformers: true,
    },
  });
  assertEquals(config.ensembleDiversity.enabled, true);
  assertEquals(config.ensembleDiversity.diversityWeight, 0.5);
  assertEquals(config.ensembleDiversity.squashEntropyWeight, 0.1);
  assertEquals(config.ensembleDiversity.protectDiverseLowPerformers, true);
  // Non-overridden fields keep defaults
  assertEquals(
    config.ensembleDiversity.weightVarianceWeight,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.weightVarianceWeight,
  );
});

Deno.test("EnsembleDiversityConfig - boolean fields accept boolean values", () => {
  const configTrue = createNeatConfig({
    ensembleDiversity: {
      enabled: true,
      protectDiverseLowPerformers: true,
    },
  });
  assertEquals(configTrue.ensembleDiversity.enabled, true);
  assertEquals(configTrue.ensembleDiversity.protectDiverseLowPerformers, true);

  const configFalse = createNeatConfig({
    ensembleDiversity: {
      enabled: false,
      protectDiverseLowPerformers: false,
    },
  });
  assertEquals(configFalse.ensembleDiversity.enabled, false);
  assertEquals(
    configFalse.ensembleDiversity.protectDiverseLowPerformers,
    false,
  );
});

Deno.test("EnsembleDiversityConfig - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    ensembleDiversity: {
      diversityWeight: "0.3" as unknown as number,
      lowDiversityThreshold: "0.5" as unknown as number,
    },
  });
  assertEquals(config.ensembleDiversity.diversityWeight, 0.3);
  assertEquals(config.ensembleDiversity.lowDiversityThreshold, 0.5);
});
