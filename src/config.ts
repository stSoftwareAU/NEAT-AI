/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import { NetworkInterface } from "./architecture/NetworkInterface.ts";
import { Methods } from "./methods/methods.js";
import { Mutation } from "./methods/mutation.ts";
import { Cost } from "./methods/cost.js";
import { Rate } from "./methods/rate.js";

interface ScheduleInterface {
  iterations: number;
  // deno-lint-ignore ban-types
  function: Function;
}

export interface NeatOptions {
  equal?: boolean; // No clue.
  error?: number; // Target error

  clear?: boolean;

  costName?: string;
  /** The directory to store the creatures (optional) */
  creatureStore?: string;

  /** List of creatures to start with */
  creatures?: NetworkInterface[];

  growth?: number;
  elitism?: number;

  /** Once the number of minutes are reached exit the loop. */
  timeoutMinutes?: number;

  /** Tne maximum number of connections */
  maxConns?: number;

  /** Tne maximum number of gates */
  maxGates?: number;

  /** Tne maximum number of nodes */
  maxNodes?: number;

  /** Number of changes per Gene */
  mutationAmount?: number;

  /** Probability of changing a gene */
  mutationRate?: number;

  /** The target population size. */
  popsize?: number;

  threads?: number;
  selection?: any;
  mutation?: any;
  iterations?: number;
  log?: number;

  schedule?: ScheduleInterface;
  network?: NetworkInterface;
}

export interface NeatConfig {
  clear: boolean;
  /** The directory to store the creatures (optional) */
  creatureStore?: string;

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
  threads: number;
  selection: any;
  mutation: any;
  iterations: number;
  log: number;

  schedule?: ScheduleInterface;
  network?: NetworkInterface;
}

export function findCost(costName: string) {
  const values = Object.values(Cost);
  for (let i = values.length; i--;) {
    const v = values[i];

    if (v.name == costName) {
      return v;
    }
  }

  throw "Invalid cost: " + costName;
}

// deno-lint-ignore ban-types
export function findRatePolicy(ratePolicy: string): Function {
  const values = Object.values(Rate);
  for (let i = values.length; i--;) {
    const v = values[i];

    if (v.name == ratePolicy) {
      return v;
    }
  }

  throw "Invalid cost: " + ratePolicy;
}

export function make(parameters?: NeatOptions) {
  const options = parameters || {};

  const config: NeatConfig = {
    clear: options.clear || false,

    creatureStore: options.creatureStore,
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

    network: options.network,
    threads: Math.round(
      Math.max(
        options.threads ? options.threads : navigator.hardwareConcurrency,
        1,
      ),
    ),
    timeoutMinutes: options.timeoutMinutes,

    log: options.log ? options.log : 0,
    schedule: options.schedule,
  };

  return config;
}
