import type { NeatOptions } from "../../mod.ts";
import { Selection, type SelectionInterface } from "../methods/Selection.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { NeatArguments } from "./NeatOptions.ts";
import { DEFAULT_RUST_FLUSH_RECORDS } from "../architecture/ErrorGuidedStructuralEvolution/constants.ts";

/**
 * Interface for NEAT (NeuroEvolution of Augmenting Topologies) training options.
 * Provides a read-only configuration object for the NEAT algorithm.
 */
export type NeatConfig = Readonly<NeatArguments>;

/**
 * Creates a validated NEAT configuration from user options.
 *
 * This function takes partial user options and fills in default values
 * to create a complete, validated configuration for the NEAT algorithm.
 * It handles selection strategy randomization and validates all parameters
 * to ensure they are within acceptable ranges.
 *
 * @param options - Partial configuration options from the user
 * @returns A frozen, validated NEAT configuration object
 * @throws {Error} When configuration parameters are invalid
 *
 * @example
 * ```ts
 * const config = createNeatConfig({
 *   populationSize: 100,
 *   mutationRate: 0.3,
 *   costName: "MSE"
 * });
 * ```
 */
export function createNeatConfig(options: NeatOptions) {
  let selection: SelectionInterface = Selection.POWER;
  if (options.selection) {
    selection = options.selection;
  } else {
    const r0 = Math.random();
    if (r0 < 0.33) {
      selection = Selection.FITNESS_PROPORTIONATE;
    } else if (r0 < 0.66) {
      selection = Selection.TOURNAMENT;
    }
  }

  const config: NeatArguments = {
    creativeThinkingConnectionCount: options.creativeThinkingConnectionCount ??
      1,
    creatureStore: options.creatureStore,
    experimentStore: options.experimentStore,
    creatures: options.creatures ? options.creatures : [],
    costName: options.costName || "MSE",
    dataSetPartitionBreak: options.dataSetPartitionBreak ?? 2000,
    trainingSampleRate: options.trainingSampleRate ?? 1,

    debug: options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false,

    feedbackLoop: options.feedbackLoop || false,
    disableRandomSamples: options.disableRandomSamples ??
      options.feedbackLoop === true,
    focusList: options.focusList || [],
    focusRate: options.focusRate || 0.25,

    targetError: options.targetError ?? 0.05,

    costOfGrowth: Math.max(
      options.costOfGrowth ?? 0.000_000_1,
      0.000_000_000_1,
    ),

    iterations: options.iterations ?? Number.MAX_SAFE_INTEGER,

    populationSize: options.populationSize || 50,
    elitism: options.elitism || 1,

    maxConns: options.maxConns || Number.MAX_SAFE_INTEGER,
    maximumNumberOfNodes: options.maximumNumberOfNodes ||
      Number.MAX_SAFE_INTEGER,
    mutationRate: options.mutationRate || 0.3,

    mutationAmount: options.mutationAmount ?? 1,

    mutation: options.mutation ? [...options.mutation] : [...Mutation.FFW],
    selection: selection,
    timeoutMinutes: options.timeoutMinutes ?? 0,
    traceStore: options.traceStore,
    trainPerGen: options.trainPerGen ?? 1,

    log: options.log ?? (options.verbose ? 1 : 0),
    verbose: options.verbose ? true : false,

    enableRepetitiveTraining: options.enableRepetitiveTraining || false,

    trainingBatchSize: options.trainingBatchSize || 100,
    threads: options.threads ??
      Math.max(1, navigator.hardwareConcurrency ?? 1),

    maximumBiasAdjustmentScale: options.maximumBiasAdjustmentScale ?? 1,

    maximumWeightAdjustmentScale: options.maximumWeightAdjustmentScale ?? 1,
    sparseRatio: options.sparseRatio ?? Math.random() * Math.random(),
    globalBreedingRate: Math.max(
      Math.min(options.globalBreedingRate ?? Math.random(), 1),
      0,
    ),
    CRISPRs: options.CRISPRs || [],
    geneticCompatibilityThreshold: options.geneticCompatibilityThreshold || 0.3,
    discoverySampleRate: options.discoverySampleRate === undefined
      ? 0.05
      : options.discoverySampleRate,
    discoveryDisableSynapseCandidates:
      options.discoveryDisableSynapseCandidates ?? false,
    discoveryDisableNeuronCandidates:
      options.discoveryDisableNeuronCandidates ?? false,
    discoveryDisableHarmfulCandidates:
      options.discoveryDisableHarmfulCandidates ?? false,
    discoveryDisableHarmfulNeuronCandidates:
      options.discoveryDisableHarmfulNeuronCandidates ?? false,
    discoveryDisableSquashCandidates:
      options.discoveryDisableSquashCandidates ?? false,

    discoveryTimeOutMinutes: options.discoveryTimeOutMinutes ?? 1, // Default 1 min for recording (was 0)
    discoveryAnalysisTimeoutMinutes: options.discoveryAnalysisTimeoutMinutes ??
      10, // Default 10 min for analysis (was 3 - production-tuned)
    discoveryBatchSize: options.discoveryBatchSize || 128,
    discoveryBufferSize: options.discoveryBufferSize || 0,
    discoveryRustFlushRecords: options.discoveryRustFlushRecords ??
      DEFAULT_RUST_FLUSH_RECORDS,
    discoveryMaxNeurons: options.discoveryMaxNeurons ?? 6, // Default 6 neurons (was 0 - production-tuned)
    discoveryDrainEveryNBatches: options.discoveryDrainEveryNBatches ?? 10,
    discoveryFocusNeuronUUIDs: options.discoveryFocusNeuronUUIDs
      ? [...options.discoveryFocusNeuronUUIDs]
      : [],
    customCost: options.customCost,
    checkpointEveryGeneration: options.checkpointEveryGeneration ?? false,
  };
  validate(config);
  return Object.freeze(config);
}

function validate(config: NeatArguments) {
  if (
    Number.isFinite(config.sparseRatio) === false || config.sparseRatio < 0 ||
    config.sparseRatio > 1
  ) {
    throw new Error(
      `Sparse Ratio must be between 0 and 1 was: ${config.sparseRatio}`,
    );
  }

  if (config.feedbackLoop === true && config.disableRandomSamples === false) {
    throw new Error(
      "Feedback Loop, Disable Random Samples must be set together",
    );
  }
  if (Number.isInteger(config.threads) === false || config.threads < 1) {
    throw new Error(
      `Threads must be more than zero was: ${config.threads}`,
    );
  }

  if (Number.isInteger(config.log) === false || config.log < 0) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (
    Number.isInteger(config.trainPerGen) === false || config.trainPerGen < 0
  ) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (
    Number.isInteger(config.timeoutMinutes) === false ||
    config.timeoutMinutes < 0
  ) {
    throw new Error(
      `Timeout Minutes must be zero or more: ${config.timeoutMinutes}`,
    );
  }
  if (Number.isInteger(config.dataSetPartitionBreak) === false) {
    throw new Error(
      "Data Set Partition Break must be an integer was: " +
        config.dataSetPartitionBreak,
    );
  }
  if (config.dataSetPartitionBreak < 1) {
    throw new Error(
      "Data Set Partition Break must be more than zero was: " +
        config.dataSetPartitionBreak,
    );
  }

  if (config.populationSize < 2) {
    throw new Error(
      "Population Size must be more than 1 was: " + config.populationSize,
    );
  }

  if (config.elitism < 1) {
    throw new Error("Elitism must be more than zero was: " + config.elitism);
  }

  if (config.maxConns < 1 || Number.isInteger(config.maxConns) === false) {
    throw new Error(
      "Max Connections must be more than zero was: " + config.maxConns,
    );
  }

  if (
    Number.isInteger(config.maximumNumberOfNodes) === false ||
    config.maximumNumberOfNodes < 1
  ) {
    throw new Error(
      `Maximum Number of Nodes must be more than zero was: ${config.maximumNumberOfNodes}`,
    );
  }

  if (config.mutationRate <= 0.001) {
    throw new Error(
      `Mutation Rate must be more than zero was: ${config.mutationRate}`,
    );
  }

  if (config.iterations < 0) {
    throw new Error(
      "Iterations must be more than zero was: " + config.iterations,
    );
  }

  if (config.trainingBatchSize < 1) {
    throw new Error(
      "Training Batch Size must be more than zero was: " +
        config.trainingBatchSize,
    );
  }
  if (
    Number.isFinite(config.trainingSampleRate) === false ||
    config.trainingSampleRate < 0.0001 || config.trainingSampleRate > 1
  ) {
    throw new Error(
      `Training Sample Rate must be between 0.0001 and 1 was: ${config.trainingSampleRate}`,
    );
  }
  if (
    Number.isInteger(config.mutationAmount) === false ||
    config.mutationAmount < 1
  ) {
    throw new Error(
      `Mutation Amount must be more than zero was: ${config.mutationAmount}`,
    );
  }

  if (
    Number.isFinite(config.targetError) === false || config.targetError < 0 ||
    config.targetError > 1
  ) {
    throw new Error(
      `Target error must be between 0 and 1 was: ${config.targetError}`,
    );
  }

  if (
    Number.isFinite(config.maximumBiasAdjustmentScale) === false ||
    config.maximumBiasAdjustmentScale < 0
  ) {
    throw new Error(
      `Maximum Bias Adjustment Scale must be more than zero was: ${config.maximumBiasAdjustmentScale}`,
    );
  }
  if (
    Number.isFinite(config.maximumWeightAdjustmentScale) === false ||
    config.maximumWeightAdjustmentScale < 0
  ) {
    throw new Error(
      `Maximum Weight Adjustment Scale must be more than zero was: ${config.maximumWeightAdjustmentScale}`,
    );
  }
  if (
    Number.isFinite(config.geneticCompatibilityThreshold) === false ||
    config.geneticCompatibilityThreshold < 0 ||
    config.geneticCompatibilityThreshold > 1
  ) {
    throw new Error(
      `Genetic Compatibility Threshold must be between 0 and 1 was: ${config.geneticCompatibilityThreshold}`,
    );
  }
  if (
    Number.isFinite(config.discoveryAnalysisTimeoutMinutes) === false ||
    config.discoveryAnalysisTimeoutMinutes <= 0
  ) {
    throw new Error(
      `Discovery Analysis Timeout Minutes must be greater than 0 was: ${config.discoveryAnalysisTimeoutMinutes}`,
    );
  }
  if (
    Number.isInteger(config.discoveryRustFlushRecords) === false ||
    config.discoveryRustFlushRecords < 1
  ) {
    throw new Error(
      `Discovery Rust Flush Records must be an integer greater than 0 was: ${config.discoveryRustFlushRecords}`,
    );
  }
  if (!Array.isArray(config.discoveryFocusNeuronUUIDs)) {
    throw new Error(
      "Discovery focus neuron UUIDs must be an array when provided.",
    );
  }
  for (const uuid of config.discoveryFocusNeuronUUIDs) {
    if (typeof uuid !== "string" || uuid.trim().length === 0) {
      throw new Error(
        `Discovery focus neuron UUIDs must be non-empty strings, found: ${
          String(uuid)
        }`,
      );
    }
  }
}
