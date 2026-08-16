import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("NeatOptions - empty options produces config with known defaults", () => {
  const config = createNeatConfig({});
  assertEquals(config.populationSize, 50);
  assertEquals(config.mutationRate, 0.3);
});

Deno.test("NeatOptions - numeric string coercion for top-level fields", () => {
  const config = createNeatConfig({
    populationSize: "100" as unknown as number,
    mutationRate: "0.5" as unknown as number,
    targetError: "0.01" as unknown as number,
    iterations: "500" as unknown as number,
    elitism: "2" as unknown as number,
    trainPerGen: "3" as unknown as number,
    trainingBatchSize: "64" as unknown as number,
    threads: "4" as unknown as number,
    timeoutMinutes: "30" as unknown as number,
  });
  assertEquals(config.populationSize, 100);
  assertEquals(config.mutationRate, 0.5);
  assertEquals(config.targetError, 0.01);
  assertEquals(config.iterations, 500);
  assertEquals(config.elitism, 2);
  assertEquals(config.trainPerGen, 3);
  assertEquals(config.trainingBatchSize, 64);
  assertEquals(config.threads, 4);
  assertEquals(config.timeoutMinutes, 30);
});

Deno.test("NeatOptions - partial overrides for sub-object configs", () => {
  const config = createNeatConfig({
    biasRegularisation: { enabled: false },
    weightRegularisation: { l2Strength: 0.5 },
    quantumStep: { errorScale: 20 },
  });
  assertEquals(config.biasRegularisation.enabled, false);
  assertEquals(config.weightRegularisation.l2Strength, 0.5);
  assertEquals(config.quantumStep.errorScale, 20);
});

Deno.test("NeatOptions - CoerceNumeric handles nested sub-object string values", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: "3" as unknown as number,
    },
    adaptiveMutationThresholds: {
      medium: "50" as unknown as number,
      large: "200" as unknown as number,
    },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 3);
  assertEquals(config.adaptiveMutationThresholds.medium, 50);
  assertEquals(config.adaptiveMutationThresholds.large, 200);
});

Deno.test("NeatOptions - invalid numeric string throws", () => {
  assertThrows(
    () =>
      createNeatConfig({
        populationSize: "not_a_number" as unknown as number,
      }),
    Error,
  );
});

Deno.test("NeatOptions - Omit list allows partial sub-object overrides", () => {
  // NeatOptions Omit list should allow partial configs for sub-objects
  // while NeatArguments requires Required<> versions
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: { addNeurons: 5 },
    adaptiveMutationThresholds: { medium: 30, large: 150 },
    plateauDetection: { enabled: true },
    weightRegularisation: { enabled: false },
    biasRegularisation: { maxAbsoluteBias: 50 },
    quantumStep: { minStep: 0.001 },
    fineTunePopulation: { successRateWindow: 5 },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 5);
  assertEquals(config.adaptiveMutationThresholds.medium, 30);
  assertEquals(config.plateauDetection.enabled, true);
  assertEquals(config.weightRegularisation.enabled, false);
  assertEquals(config.biasRegularisation.maxAbsoluteBias, 50);
  assertEquals(config.quantumStep.minStep, 0.001);
  assertEquals(config.fineTunePopulation.successRateWindow, 5);
});

// Issue #3569: hyperparameterEvolution was removed — the feature was fully
// implemented but its `enabled` flag was never turned on by any consumer, so
// no creature ever acquired a `hyperparameters` block. The parsed config must
// no longer carry it (regression guard against reintroduction).
Deno.test("NeatOptions - hyperparameterEvolution is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "hyperparameterEvolution"), false);
});

// Issue #3568 / later cleanup: specialist and OPD were removed as unused
// experiments — the parsed config must no longer carry them.
Deno.test("NeatOptions - specialist is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "specialist"), false);
});

Deno.test("NeatOptions - opd is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "opd"), false);
});

// Issue #3562: stabilityAdaptation was removed as an unimplemented option — the
// parsed config must no longer carry it (regression guard against reintroduction).
Deno.test("NeatOptions - stabilityAdaptation is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "stabilityAdaptation"), false);
});

// Issue #3558: ensembleDiversity was removed as an unimplemented option — the
// parsed config must no longer carry it (regression guard against reintroduction).
Deno.test("NeatOptions - ensembleDiversity is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "ensembleDiversity"), false);
});

// Issue #3559: novelty selection was removed as an opt-in feature with zero
// adopters — the parsed config must no longer carry it (regression guard
// against reintroduction).
Deno.test("NeatOptions - novelty is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "novelty"), false);
});

// Issue #3554: the dnaSharingMode knob preset was retired — nobody set it and
// the default preset equalled the per-knob defaults, which are now inline. The
// parsed config must no longer carry it (regression guard against
// reintroduction).
Deno.test("NeatOptions - dnaSharingMode is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "dnaSharingMode"), false);
});

// Issue #3553: enableRepetitiveTraining was removed as an unused option — the
// parsed config must no longer carry it (regression guard against reintroduction).
Deno.test("NeatOptions - enableRepetitiveTraining is not a config key", () => {
  const config = createNeatConfig({}) as unknown as Record<string, unknown>;
  assertEquals(Object.hasOwn(config, "enableRepetitiveTraining"), false);
});

Deno.test("NeatOptions - seed option produces deterministic RNG", () => {
  const config1 = createNeatConfig({ seed: 42 });
  const config2 = createNeatConfig({ seed: 42 });
  // Same seed should produce identical sequences
  const seq1 = [
    config1.rng.random(),
    config1.rng.random(),
    config1.rng.random(),
  ];
  const seq2 = [
    config2.rng.random(),
    config2.rng.random(),
    config2.rng.random(),
  ];
  assertEquals(seq1, seq2);
  assertEquals(config1.rng.seeded, true);
});

Deno.test("NeatOptions - seed accepts string from CLI", () => {
  const config = createNeatConfig({
    seed: "123" as unknown as number,
  });
  assertEquals(config.rng.seeded, true);
  // Should produce same sequence as numeric seed 123
  const configNumeric = createNeatConfig({ seed: 123 });
  assertEquals(config.rng.random(), configNumeric.rng.random());
});

Deno.test("NeatOptions - logLevel option is accepted", () => {
  const config = createNeatConfig({ logLevel: "warn" });
  assertEquals(typeof config.logger.info, "function");
});

Deno.test("NeatOptions - verbose enables logging", () => {
  const config = createNeatConfig({ verbose: true });
  assertEquals(config.verbose, true);
  assertEquals(config.log, 1);
});

Deno.test("NeatOptions - feedbackLoop requires disableRandomSamples", () => {
  // feedbackLoop=true should auto-set disableRandomSamples=true
  const config = createNeatConfig({
    feedbackLoop: true,
    disableRandomSamples: true,
  });
  assertEquals(config.feedbackLoop, true);
  assertEquals(config.disableRandomSamples, true);
});

Deno.test("NeatOptions - feedbackLoop without disableRandomSamples throws", () => {
  assertThrows(
    () =>
      createNeatConfig({
        feedbackLoop: true,
        disableRandomSamples: false,
      }),
    Error,
    "Feedback Loop",
  );
});
