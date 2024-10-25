import type { NeatOptions } from "../../mod.ts";
import { Selection, type SelectionInterface } from "../methods/Selection.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { NeatArguments } from "./NeatOptions.ts";

/**
 * Interface for NEAT (NeuroEvolution of Augmenting Topologies) training options.
 */
export type NeatConfig = Readonly<NeatArguments>;

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
    disableRandomSamples: options.disableRandomSamples ?? false,
    trainingSampleRate: options.trainingSampleRate ?? 1,

    debug: options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false,

    feedbackLoop: options.feedbackLoop || false,
    focusList: options.focusList || [],
    focusRate: options.focusRate || 0.25,

    targetError: options.targetError ?? 0.05,

    costOfGrowth: options.costOfGrowth ?? 0.000_1,

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

    log: options.log ?? 0,
    verbose: options.verbose ? true : false,

    enableRepetitiveTraining: options.enableRepetitiveTraining || false,

    trainingBatchSize: options.trainingBatchSize || 100,
    threads: options.threads || navigator.hardwareConcurrency,
  };
  validate(config);
  return Object.freeze(config);
}

function validate(config: NeatArguments) {
  if (Number.isInteger(config.threads) == false || config.threads < 1) {
    throw new Error(
      `Threads must be more than zero was: ${config.threads}`,
    );
  }

  if (Number.isInteger(config.log) == false || config.log < 0) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (Number.isInteger(config.trainPerGen) == false || config.trainPerGen < 0) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (
    Number.isInteger(config.timeoutMinutes) == false ||
    config.timeoutMinutes < 0
  ) {
    throw new Error(
      `Timeout Minutes must be zero or more: ${config.timeoutMinutes}`,
    );
  }
  if (Number.isInteger(config.dataSetPartitionBreak) == false) {
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

  if (config.maxConns < 1 || Number.isInteger(config.maxConns) == false) {
    throw new Error(
      "Max Connections must be more than zero was: " + config.maxConns,
    );
  }

  if (
    Number.isInteger(config.maximumNumberOfNodes) == false ||
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

  if (config.mutationAmount < 1) {
    throw new Error(
      `Mutation Amount must be more than zero was: ${config.mutationAmount}`,
    );
  }

  if (config.iterations < 0) {
    throw new Error(
      "Iterations must be more than zero was: " + config.iterations,
    );
  }

  if (config.timeoutMinutes < 0) {
    throw new Error(
      "Timeout Minutes must be more than zero was: " + config.timeoutMinutes,
    );
  }

  if (config.trainingBatchSize < 1) {
    throw new Error(
      "Training Batch Size must be more than zero was: " +
        config.trainingBatchSize,
    );
  }
  if (
    Number.isFinite(config.trainingSampleRate) == false ||
    config.trainingSampleRate < 0.0001 || config.trainingSampleRate > 1
  ) {
    throw new Error(
      `Training Sample Rate must be between 0.0001 and 1 was: ${config.trainingSampleRate}`,
    );
  }
  if (
    Number.isInteger(config.mutationAmount) == false ||
    config.mutationAmount < 1
  ) {
    throw new Error(
      `Mutation Amount must be more than zero was: ${config.mutationAmount}`,
    );
  }

  if (
    Number.isFinite(config.targetError) == false || config.targetError < 0 ||
    config.targetError > 1
  ) {
    throw new Error(
      `Target error must be between 0 and 1 was: ${config.targetError}`,
    );
  }
}
