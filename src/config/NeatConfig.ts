import { assert } from "@std/assert";
import type { NeatOptions } from "../../mod.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import { Selection, type SelectionInterface } from "../methods/Selection.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { MutationInterface } from "../NEAT/MutationInterface.ts";

export class NeatConfig implements NeatOptions {
  /** List of creatures to start with */
  creatures: CreatureInternal[] | CreatureExport[];

  creativeThinkingConnectionCount: number;
  creatureStore?: string;
  experimentStore?: string;

  /** number of records per dataset file. default: 2000 */
  dataSetPartitionBreak?: number;
  disableRandomSamples?: boolean;
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
  timeoutMinutes?: number;

  costOfGrowth: number;

  /** The maximum number of connections */
  maxConns: number;

  /** The maximum number of nodes */
  maximumNumberOfNodes: number;

  /** Number of changes per Gene */
  mutationAmount: number;

  /** Probability of changing a single gene */
  mutationRate: number;

  /** The target population size. */
  populationSize: number;

  costName: string;
  traceStore?: string;

  /** the number of training per generation. default: 1  */
  trainPerGen: number;

  selection: SelectionInterface;
  readonly mutation: MutationInterface[];

  iterations: number;
  log: number;
  /** verbose logging default: false */
  verbose: boolean;
  trainingSampleRate?: number;

  backPropagationExcludeSquashList: string;
  constructor(options: NeatOptions) {
    this.creativeThinkingConnectionCount =
      options.creativeThinkingConnectionCount ?? 1;
    this.creatureStore = options.creatureStore;
    this.experimentStore = options.experimentStore;
    this.creatures = options.creatures ? options.creatures : [];
    this.costName = options.costName || "MSE";
    this.dataSetPartitionBreak = options.dataSetPartitionBreak;
    this.disableRandomSamples = options.disableRandomSamples;
    this.trainingSampleRate = options.trainingSampleRate;

    this.debug = options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false;

    this.feedbackLoop = options.feedbackLoop || false;
    this.focusList = options.focusList || [];
    this.focusRate = options.focusRate || 0.25;

    this.targetError = Math.min(
      1,
      Math.max(Math.abs(options.targetError ?? 0.05), 0),
    );

    this.costOfGrowth = options.costOfGrowth ?? 0.000_1;

    this.iterations = options.iterations ?? 0;

    this.populationSize = options.populationSize || 50;
    this.elitism = options.elitism || 1;
    assert(Number.isInteger(this.elitism));
    assert(this.elitism > 0);

    this.maxConns = options.maxConns || Infinity;
    this.maximumNumberOfNodes = options.maximumNumberOfNodes || Infinity;
    this.mutationRate = options.mutationRate || 0.3;

    this.mutationAmount = options.mutationAmount
      ? options.mutationAmount > 1 ? options.mutationAmount : 1
      : 1;

    this.mutation = options.mutation
      ? [...options.mutation]
      : [...Mutation.FFW];

    if (options.selection) {
      this.selection = options.selection;
    } else {
      const r0 = Math.random();
      if (r0 < 0.33) {
        this.selection = Selection.FITNESS_PROPORTIONATE;
      } else if (r0 < 0.66) {
        this.selection = Selection.TOURNAMENT;
      } else {
        this.selection = Selection.POWER;
      }
    }

    this.timeoutMinutes = options.timeoutMinutes;
    this.traceStore = options.traceStore;
    this.trainPerGen = options.trainPerGen ?? 1;

    this.log = options.log ?? 0;
    this.verbose = options.verbose ? true : false;

    if (this.mutationAmount < 1) {
      throw new Error(
        "Mutation Amount must be more than zero was: " +
          this.mutationAmount,
      );
    }

    if (this.mutationRate <= 0.001) {
      throw new Error(
        "Mutation Rate must be more than 0.1% was: " + this.mutationRate,
      );
    }

    this.backPropagationExcludeSquashList =
      options.backPropagationExcludeSquashList
        ? options.backPropagationExcludeSquashList
        : "";
  }
}
