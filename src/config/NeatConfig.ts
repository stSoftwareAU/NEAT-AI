/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import { NetworkInterface } from "../architecture/NetworkInterface.ts";
import { NeatOptions } from "./NeatOptions.ts";
import { Methods } from "../methods/methods.js";
import { Mutation } from "../methods/mutation.ts";

export interface NeatConfig {
  clear: boolean;
  /** The directory to store the creatures (optional) */
  creatureStore?: string;

  /** The directory to store the experiments (optional) */
  experimentStore?: string;

  /** List of creatures to start with */
  creatures: NetworkInterface[];

  elitism: number;
  equal: boolean; // No clue.
  /** Target error */
  targetError: number;

  growth: number;

  /** Once the number of minutes are reached exit the loop. */
  timeoutMinutes?: number;

  /** Tne maximum number of connections */
  maxConns: number;

  /** Tne maximum number of gates */
  maxGates: number;

  /** Tne maximum number of nodes */
  maxNodes: number;
  /** Number of changes per Gene */
  mutationAmount: number;

  /** Probability of changing a gene */
  mutationRate: number;

  /** The target population size. */
  popsize: number;

  costName: string;
  /** the number of workers */
  threads: number;
  /** the initial train rate if evolving or the rate to use when training only */
  trainRate: number;

  selection: any;
  mutation: any;
  iterations: number;
  log: number;

  schedule?: ScheduleInterface;
  // network?: NetworkInterface;
}

export function make(parameters?: NeatOptions) {
  const options = parameters || {};

  const config: NeatConfig = {
    clear: options.clear || false,

    creatureStore: options.creatureStore,
    experimentStore: options.experimentStore,
    creatures: options.creatures ? options.creatures : [],
    costName: options.costName || "MSE",

    equal: options.equal || false,
    targetError: typeof options.error !== "undefined"
      ? Math.abs(options.error) * -1
      : -0.05,

    growth: typeof options.growth !== "undefined" ? options.growth : 0.0001,

    iterations: options.iterations ? options.iterations : 0,

    popsize: options.popsize || 50,
    elitism: options.elitism || 1,

    maxConns: options.maxConns || Infinity,
    maxGates: options.maxGates || Infinity,
    maxNodes: options.maxNodes || Infinity,
    mutationRate: options.mutationRate || 0.3,

    mutationAmount: options.mutationAmount || 1,
    mutation: options.mutation || Mutation.FFW,
    selection: options.selection || Methods.selection.POWER,

    threads: Math.round(
      Math.max(
        options.threads ? options.threads : navigator.hardwareConcurrency,
        1,
      ),
    ),
    timeoutMinutes: options.timeoutMinutes,
    trainRate: options.trainRate ? options.trainRate : 0.01,

    log: options.log ? options.log : 0,
    schedule: options.schedule,
  };

  return config;
}
