/**
 * Tests that verify the default configuration values documented in
 * docs/CONFIGURATION_GUIDE.md remain accurate.
 *
 * These tests import the actual default constants from source and assert
 * their values match what the configuration guide documents. If a default
 * changes in code, these tests will fail, signalling that the guide needs
 * updating.
 */

import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  DEFAULT_COST_OF_GROWTH,
  DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY,
  DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES,
  DEFAULT_DISCOVERY_SAMPLE_RATE,
} from "../../src/config/NeatConfig.ts";
import { DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS } from "../../src/config/AdaptiveMutationThresholds.ts";
import { DEFAULT_ENSEMBLE_DIVERSITY_CONFIG } from "../../src/config/EnsembleDiversityConfig.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "../../src/config/QuantumStepConfig.ts";
import { DEFAULT_STABILITY_ADAPTATION_CONFIG } from "../../src/config/StabilityAdaptationConfig.ts";
import { DEFAULT_WEIGHT_REGULARISATION_CONFIG } from "../../src/config/WeightRegularisationConfig.ts";
import { DEFAULT_BIAS_REGULARISATION_CONFIG } from "../../src/config/BiasRegularisationConfig.ts";
import { DEFAULT_FINE_TUNE_POPULATION_CONFIG } from "../../src/config/FineTunePopulationConfig.ts";
import { DEFAULT_PLATEAU_DETECTION } from "../../src/NEAT/PlateauDetector.ts";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/constants.ts";

Deno.test("Configuration guide - core evolution defaults match code", () => {
  const config = createNeatConfig({});

  // Core evolution parameters
  assertEquals(config.populationSize, 50);
  assertEquals(config.mutationRate, 0.3);
  assertEquals(config.mutationAmount, 1);
  assertEquals(config.elitism, 1);
  assertEquals(config.targetError, 0.05);
  assertEquals(config.costName, "MSE");
  assertEquals(config.trainingSampleRate, 1);
  assertEquals(config.trainPerGen, 1);
  assertEquals(config.trainingBatchSize, 100);
  assertEquals(config.dataSetPartitionBreak, 2000);
  assertEquals(config.creativeThinkingConnectionCount, 1);
  assertEquals(config.geneticCompatibilityThreshold, 0.3);
  assertEquals(config.feedbackLoop, false);
  assertEquals(config.debug, false);
  assertEquals(config.verbose, false);
  assertEquals(config.timeoutMinutes, 0);
  assertEquals(config.costOfGrowth, DEFAULT_COST_OF_GROWTH);
  assertEquals(DEFAULT_COST_OF_GROWTH, 0.000_000_1);
});

Deno.test("Configuration guide - discovery defaults match code", () => {
  const config = createNeatConfig({});

  assertEquals(config.discoverySampleRate, DEFAULT_DISCOVERY_SAMPLE_RATE);
  assertEquals(DEFAULT_DISCOVERY_SAMPLE_RATE, 0.2);

  assertEquals(
    config.discoveryRecordTimeOutMinutes,
    DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES,
  );
  assertEquals(DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES, 5);

  assertEquals(config.discoveryAnalysisTimeoutMinutes, 10);
  assertEquals(config.discoveryBatchSize, 128);
  assertEquals(config.discoveryMaxNeurons, 6);
  assertEquals(config.discoveryDrainEveryNBatches, 10);
  assertEquals(config.discoveryRustFlushRecords, DEFAULT_RUST_FLUSH_RECORDS);
  assertEquals(DEFAULT_RUST_FLUSH_RECORDS, 4_096);
  assertEquals(config.discoveryRustFlushBytes, DEFAULT_RUST_FLUSH_BYTES);
  assertEquals(DEFAULT_RUST_FLUSH_BYTES, 50 * 1024 * 1024);

  // Discovery min candidates per category
  const minCandidates = DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY;
  assertEquals(minCandidates.addNeurons, 1);
  assertEquals(minCandidates.addSynapses, 1);
  assertEquals(minCandidates.changeSquash, 1);
  assertEquals(minCandidates.removeLowImpact, 3);
});

Deno.test("Configuration guide - adaptive mutation defaults match code", () => {
  const defaults = DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS;
  assertEquals(defaults.medium, 100);
  assertEquals(defaults.large, 300);
  assertEquals(defaults.largeTopologyWeight, 0.1);
});

Deno.test("Configuration guide - plateau detection defaults match code", () => {
  const defaults = DEFAULT_PLATEAU_DETECTION;
  assertEquals(defaults.enabled, false);
  assertEquals(defaults.windowSize, 10);
  assertEquals(defaults.minImprovementRate, 0.001);
  assertEquals(defaults.rapidImprovementRate, 0.01);
  assertEquals(defaults.responseMutationMultiplier, 2.0);
  assertEquals(defaults.responseImprovementMultiplier, 0.8);
});

Deno.test("Configuration guide - stability adaptation defaults match code", () => {
  const defaults = DEFAULT_STABILITY_ADAPTATION_CONFIG;
  assertEquals(defaults.enabled, false);
  assertEquals(defaults.stabilityWindowSize, 20);
  assertEquals(defaults.brittlenessThreshold, 0.3);
  assertEquals(defaults.brittleReductionFactor, 0.5);
  assertEquals(defaults.stableBoostFactor, 1.3);
  assertEquals(defaults.stableBoostThreshold, 0.85);
  assertEquals(defaults.selectionStabilityWeight, 0.2);
  assertEquals(defaults.adaptiveSelectionWeight, false);
  assertEquals(defaults.topologyMutationReductionForBrittle, 0.3);
  assertEquals(defaults.trackPerMutationType, false);
});

Deno.test("Configuration guide - weight regularisation defaults match code", () => {
  const defaults = DEFAULT_WEIGHT_REGULARISATION_CONFIG;
  assertEquals(defaults.enabled, true);
  assertEquals(defaults.maxAbsoluteWeight, 100);
  assertEquals(defaults.maxWeightChange, 10);
  assertEquals(defaults.l2Strength, 0.1);
  assertEquals(defaults.preferSmallChanges, true);
  assertEquals(defaults.smallChangeScale, 0.5);
});

Deno.test("Configuration guide - bias regularisation defaults match code", () => {
  const defaults = DEFAULT_BIAS_REGULARISATION_CONFIG;
  assertEquals(defaults.enabled, true);
  assertEquals(defaults.maxAbsoluteBias, 100);
  assertEquals(defaults.maxBiasChange, 10);
  assertEquals(defaults.l2Strength, 0.1);
  assertEquals(defaults.preferSmallChanges, true);
  assertEquals(defaults.smallChangeScale, 0.5);
});

Deno.test("Configuration guide - ensemble diversity defaults match code", () => {
  const defaults = DEFAULT_ENSEMBLE_DIVERSITY_CONFIG;
  assertEquals(defaults.enabled, false);
  assertEquals(defaults.diversityWeight, 0.15);
  assertEquals(defaults.weightVarianceWeight, 0.4);
  assertEquals(defaults.squashEntropyWeight, 0.3);
  assertEquals(defaults.topologyDiversityWeight, 0.3);
  assertEquals(defaults.protectDiverseLowPerformers, false);
  assertEquals(defaults.diversityProtectionThreshold, 0.7);
  assertEquals(defaults.crossSpeciesBreedingThreshold, 0.2);
  assertEquals(defaults.lowDiversityThreshold, 0.3);
  assertEquals(defaults.diverseParentPreferenceWeight, 0.2);
});

Deno.test("Configuration guide - quantum step defaults match code", () => {
  const defaults = DEFAULT_QUANTUM_STEP_CONFIG;
  assertEquals(defaults.minStep, 0.000_000_1);
  assertEquals(defaults.maxStep, 0.001);
  assertEquals(defaults.errorScale, 10);
});

Deno.test("Configuration guide - fine-tune population defaults match code", () => {
  const defaults = DEFAULT_FINE_TUNE_POPULATION_CONFIG;
  assertEquals(defaults.minPopulationFraction, 0.1);
  assertEquals(defaults.maxPopulationFraction, 0.4);
  assertEquals(defaults.basePopulationFraction, 0.2);
  assertEquals(defaults.successRateWindow, 10);
});

Deno.test("Configuration guide - discovery replay defaults match code", () => {
  const config = createNeatConfig({});
  assertEquals(config.discoveryReplayMaxPairwise, 10);
  assertEquals(config.discoveryReplayMaxTriples, 8);
  assertEquals(config.discoveryReplayVerifyScores, false);
  assertEquals(config.discoveryReplayRescoreBaseline, false);
  assertEquals(config.discoveryReplayDiagnostics, false);
  assertEquals(config.discoveryReplayTimeoutMinutes, 5);
  assertEquals(config.discoveryReplayMinTimeMinutes, 1);
});
