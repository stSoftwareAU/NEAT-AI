import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("NeatOptions - empty options produces valid config", () => {
  const config = createNeatConfig({});
  assertEquals(typeof config.populationSize, "number");
  assertEquals(typeof config.mutationRate, "number");
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
    stabilityAdaptation: { enabled: true },
    weightRegularisation: { enabled: false },
    biasRegularisation: { maxAbsoluteBias: 50 },
    ensembleDiversity: { enabled: true },
    quantumStep: { minStep: 0.001 },
    fineTunePopulation: { successRateWindow: 5 },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 5);
  assertEquals(config.adaptiveMutationThresholds.medium, 30);
  assertEquals(config.plateauDetection.enabled, true);
  assertEquals(config.stabilityAdaptation.enabled, true);
  assertEquals(config.weightRegularisation.enabled, false);
  assertEquals(config.biasRegularisation.maxAbsoluteBias, 50);
  assertEquals(config.ensembleDiversity.enabled, true);
  assertEquals(config.quantumStep.minStep, 0.001);
  assertEquals(config.fineTunePopulation.successRateWindow, 5);
});

Deno.test("NeatOptions - seed option produces deterministic RNG", () => {
  const config1 = createNeatConfig({ seed: 42 });
  const config2 = createNeatConfig({ seed: 42 });
  // Same seed should produce same first random value
  assertEquals(config1.rng.random(), config2.rng.random());
});

Deno.test("NeatOptions - seed accepts string from CLI", () => {
  const config = createNeatConfig({
    seed: "123" as unknown as number,
  });
  assertEquals(typeof config.rng.random(), "number");
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
