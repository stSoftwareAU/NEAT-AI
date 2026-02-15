import { assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_BIAS_REGULARISATION_CONFIG } from "../../src/config/BiasRegularisationConfig.ts";
import { DEFAULT_WEIGHT_REGULARISATION_CONFIG } from "../../src/config/WeightRegularisationConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "../../src/config/QuantumStepConfig.ts";
import { DEFAULT_ENSEMBLE_DIVERSITY_CONFIG } from "../../src/config/EnsembleDiversityConfig.ts";
import { DEFAULT_FINE_TUNE_POPULATION_CONFIG } from "../../src/config/FineTunePopulationConfig.ts";
import { DEFAULT_STABILITY_ADAPTATION_CONFIG } from "../../src/config/StabilityAdaptationConfig.ts";
import { DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS } from "../../src/config/AdaptiveMutationThresholds.ts";
import {
  DEFAULT_COST_OF_GROWTH,
  DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY,
} from "../../src/config/NeatConfig.ts";

Deno.test("NeatArguments - default config has all required top-level fields", () => {
  const config = createNeatConfig({});

  // Verify string fields
  assertEquals(config.costName, "MSE");

  // Verify numeric fields have sensible defaults
  assertEquals(typeof config.creativeThinkingConnectionCount, "number");
  assertEquals(typeof config.dataSetPartitionBreak, "number");
  assertEquals(typeof config.trainingSampleRate, "number");
  assertEquals(typeof config.targetError, "number");
  assertEquals(typeof config.costOfGrowth, "number");
  assertEquals(typeof config.iterations, "number");
  assertEquals(typeof config.populationSize, "number");
  assertEquals(typeof config.elitism, "number");
  assertEquals(typeof config.maxConns, "number");
  assertEquals(typeof config.maximumNumberOfNodes, "number");
  assertEquals(typeof config.mutationRate, "number");
  assertEquals(typeof config.mutationAmount, "number");
  assertEquals(typeof config.timeoutMinutes, "number");
  assertEquals(typeof config.trainPerGen, "number");
  assertEquals(typeof config.log, "number");
  assertEquals(typeof config.trainingBatchSize, "number");
  assertEquals(typeof config.threads, "number");
  assertEquals(typeof config.maximumBiasAdjustmentScale, "number");
  assertEquals(typeof config.maximumWeightAdjustmentScale, "number");
  assertEquals(typeof config.sparseRatio, "number");
  assertEquals(typeof config.globalBreedingRate, "number");
  assertEquals(typeof config.geneticCompatibilityThreshold, "number");
  assertEquals(typeof config.discoverySampleRate, "number");

  // Verify boolean fields
  assertEquals(typeof config.debug, "boolean");
  assertEquals(typeof config.feedbackLoop, "boolean");
  assertEquals(typeof config.verbose, "boolean");
  assertEquals(typeof config.enableRepetitiveTraining, "boolean");
  assertEquals(typeof config.disableRandomSamples, "boolean");
  assertEquals(typeof config.checkpointEveryGeneration, "boolean");
});

Deno.test("NeatArguments - default config has all sub-object configs", () => {
  const config = createNeatConfig({});

  // Verify sub-object configs are present and fully populated
  assertNotEquals(config.biasRegularisation, undefined);
  assertNotEquals(config.weightRegularisation, undefined);
  assertNotEquals(config.quantumStep, undefined);
  assertNotEquals(config.ensembleDiversity, undefined);
  assertNotEquals(config.fineTunePopulation, undefined);
  assertNotEquals(config.stabilityAdaptation, undefined);
  assertNotEquals(config.adaptiveMutationThresholds, undefined);
  assertNotEquals(config.plateauDetection, undefined);
  assertNotEquals(config.discoveryMinCandidatesPerCategory, undefined);
});

Deno.test("NeatArguments - sub-object configs match their defaults", () => {
  const config = createNeatConfig({});

  // biasRegularisation
  assertEquals(
    config.biasRegularisation.enabled,
    DEFAULT_BIAS_REGULARISATION_CONFIG.enabled,
  );

  // weightRegularisation
  assertEquals(
    config.weightRegularisation.enabled,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.enabled,
  );

  // quantumStep
  assertEquals(
    config.quantumStep.minStep,
    DEFAULT_QUANTUM_STEP_CONFIG.minStep,
  );

  // ensembleDiversity
  assertEquals(
    config.ensembleDiversity.enabled,
    DEFAULT_ENSEMBLE_DIVERSITY_CONFIG.enabled,
  );

  // fineTunePopulation
  assertEquals(
    config.fineTunePopulation.minPopulationFraction,
    DEFAULT_FINE_TUNE_POPULATION_CONFIG.minPopulationFraction,
  );

  // stabilityAdaptation
  assertEquals(
    config.stabilityAdaptation.enabled,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.enabled,
  );

  // adaptiveMutationThresholds
  assertEquals(
    config.adaptiveMutationThresholds.medium,
    DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.medium,
  );

  // discoveryMinCandidatesPerCategory
  assertEquals(
    config.discoveryMinCandidatesPerCategory.addNeurons,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addNeurons,
  );
});

Deno.test("NeatArguments - default array fields are empty arrays", () => {
  const config = createNeatConfig({});
  assertEquals(config.creatures.length, 0);
  assertEquals(config.CRISPRs.length, 0);
  assertEquals(config.focusList.length, 0);
  assertEquals(config.discoveryFocusNeuronUUIDs.length, 0);
});

Deno.test("NeatArguments - default boolean fields have expected values", () => {
  const config = createNeatConfig({});
  assertEquals(config.feedbackLoop, false);
  assertEquals(config.verbose, false);
  assertEquals(config.enableRepetitiveTraining, false);
  assertEquals(config.checkpointEveryGeneration, false);
  assertEquals(config.discoveryDisableCleanup, false);
  assertEquals(config.discoverySkipRecordPhase, false);
  assertEquals(config.discoveryDisableEvaluationSummaryLogging, false);
  assertEquals(config.discoveryReplayVerifyScores, false);
  assertEquals(config.discoveryReplayDiagnostics, false);
});

Deno.test("NeatArguments - default numeric fields have expected values", () => {
  const config = createNeatConfig({});
  assertEquals(config.costName, "MSE");
  assertEquals(config.populationSize, 50);
  assertEquals(config.dataSetPartitionBreak, 2000);
  assertEquals(config.targetError, 0.05);
  assertEquals(config.costOfGrowth, DEFAULT_COST_OF_GROWTH);
  assertEquals(config.trainPerGen, 1);
  assertEquals(config.elitism, 1);
  assertEquals(config.mutationAmount, 1);
  assertEquals(config.trainingBatchSize, 100);
  assertEquals(config.creativeThinkingConnectionCount, 1);
  assertEquals(config.trainingSampleRate, 1);
});

Deno.test("NeatArguments - logger and rng are always present", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.logger, undefined);
  assertNotEquals(config.rng, undefined);
  assertEquals(typeof config.logger.info, "function");
  assertEquals(typeof config.rng.random, "function");
});

Deno.test("NeatArguments - optional string fields default to undefined", () => {
  const config = createNeatConfig({});
  assertEquals(config.creatureStore, undefined);
  assertEquals(config.experimentStore, undefined);
  assertEquals(config.traceStore, undefined);
  assertEquals(config.discoveryBaseDirectory, undefined);
});

Deno.test("NeatArguments - mutation array is populated with default mutations", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.mutation.length, 0);
});

Deno.test("NeatArguments - selection is always present", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.selection, undefined);
  assertEquals(typeof config.selection.name, "string");
});
