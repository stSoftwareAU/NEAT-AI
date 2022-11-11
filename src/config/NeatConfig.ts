/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import { NetworkInterface } from "../architecture/NetworkInterface.ts";
import { NeatOptions } from "./NeatOptions.ts";
import { Mutation, MutationInterface } from "../methods/mutation.ts";
import { Selection, SelectionInterface } from "../methods/Selection.ts";

export interface NeatConfig {
  clear: boolean;
  /** The directory to store the creatures (optional) */
  creatureStore?: string;

  /** The directory to store the experiments (optional) */
  experimentStore?: string;

  /** List of creatures to start with */
  creatures: NetworkInterface[];

  /** number of records per dataset file. default: 2000 */
  dataSetPartitionBreak: number;

  /** debug (much slower) */
  debug: boolean;

  /**
   * Feedback loop ( previous result feeds back into next interaction
   * https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html;jsessionid=2d7fa2c64f0bd39c86dec46870cd
   */
  feedbackLoop: boolean;

  /** The list of observations to focus one */
  focusList: number[];
  /** Focus rate */
  focusRate: number;

  elitism: number;

  /** Target error 0 to 1 */
  targetError: number;

  growth: number;

  /** Once the number of minutes are reached exit the loop. */
  timeoutMinutes?: number;

  /** Tne maximum number of connections */
  maxConns: number;

  /** Tne maximum number of nodes */
  maxNodes: number;

  /** Number of changes per Gene */
  mutationAmount: number;

  /** Probability of changing a single gene */
  mutationRate: number;

  /** The target population size. */
  popSize: number;

  costName: string;
  /** the number of workers */
  threads: number;
  /** the initial train rate if evolving or the rate to use when training only */
  trainRate: number;

  selection: SelectionInterface;
  mutation: MutationInterface[];

  iterations: number;
  log: number;
  /** verbose logging default: false */
  verbose: boolean;
}

export function make(parameters?: NeatOptions) {
  const options = parameters || {};

  const config: NeatConfig = {
    clear: options.clear || false,

    creatureStore: options.creatureStore,
    experimentStore: options.experimentStore,
    creatures: options.creatures ? options.creatures : [],
    costName: options.costName || "MSE",
    dataSetPartitionBreak: options.dataSetPartitionBreak
      ? Math.max(options.dataSetPartitionBreak, 1000)
      : 2000,

    debug: options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false,

    feedbackLoop: options.feedbackLoop || false,
    focusList: options.focusList || [],
    focusRate: options.focusRate || 0.25,

    targetError: options.error !== undefined
      ? Math.min(1, Math.max(Math.abs(options.error), 0))
      : 0.05,

    growth: options.growth !== undefined ? options.growth : 0.000_1,

    iterations: options.iterations ? options.iterations : 0,

    popSize: options.popSize || 50,
    elitism: options.elitism || 1,

    maxConns: options.maxConns || Infinity,
    maxNodes: options.maxNodes || Infinity,
    mutationRate: options.mutationRate || 0.3,

    mutationAmount: options.mutationAmount
      ? options.mutationAmount > 1 ? options.mutationAmount : 1
      : 1,
    mutation: options.mutation || Mutation.FFW,
    selection: options.selection || Selection.POWER,

    threads: Math.round(
      Math.max(
        options.threads ? options.threads : navigator.hardwareConcurrency,
        1,
      ),
    ),
    timeoutMinutes: options.timeoutMinutes,
    trainRate: options.trainRate ? options.trainRate : 0.01,

    log: options.log ? options.log : 0,
    verbose: options.verbose ? true : false,
  };

  if (config.mutationAmount < 1) {
    throw "Mutation Amount must be more than zero was: " +
      config.mutationAmount;
  }

  if (config.mutationRate <= 0.001) {
    throw "Mutation Rate must be more than 0.1% was: " + config.mutationRate;
  }

  return config;
}
