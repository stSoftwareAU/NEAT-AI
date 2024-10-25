import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import type { MutationInterface } from "../NEAT/MutationInterface.ts";
import type { SelectionInterface } from "../methods/Selection.ts";

/**
 * Interface for NEAT (NeuroEvolution of Augmenting Topologies) training options.
 */
export interface NeatArguments {
  /** The name of the cost function to use (optional). */
  costName: string;

  /**
   * Number of new links to create during the creative thinking phase.
   * Helps to add diversity and complexity to the neural network structure.
   */
  creativeThinkingConnectionCount: number;

  /** Directory to store the creatures (optional). */
  creatureStore?: string;

  /** Number of records per dataset file. Default is 2000. */
  dataSetPartitionBreak: number;

  /** Enable debug mode (much slower). Default is false. */
  debug: boolean;

  /** Directory to store the experiments (optional). */
  experimentStore?: string;

  /** List of creatures to start with. Can be internal or exported creatures. */
  creatures: CreatureInternal[] | CreatureExport[];

  /**
   * Enable feedback loop where the previous result feeds back into the next interaction.
   * Useful for time-series forecasting and recurrent neural networks.
   * More information: https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html
   */
  feedbackLoop: boolean;

  /** List of observations to focus on (optional). */
  focusList: number[];

  /** Focus rate, defining how much attention to give to the focus list (optional). */
  focusRate: number;

  /** Cost of growth (optional). */
  costOfGrowth: number;

  /** Percentage of the top-performing individuals to retain for the next generation. */
  elitism: number;

  /** Maximum number of minutes to run the training loop before exiting. */
  timeoutMinutes: number;

  /** Number of training sessions per generation. Default is 1. */
  trainPerGen: number;

  /** Maximum number of connections allowed in the neural network. */
  maxConns: number;

  /** Maximum number of nodes allowed in the neural network. */
  maximumNumberOfNodes: number;

  /** Number of changes to apply per gene during mutation. */
  mutationAmount: number;

  /** Probability of mutating a gene. */
  mutationRate: number;

  /** Target population size for the NEAT algorithm. Default is 50. */
  populationSize: number;

  /** Number of worker threads to use for parallel processing. 1 or more */
  threads: number;

  /** Selection method to use for choosing individuals for the next generation. */
  selection: SelectionInterface;

  /** List of mutation methods to apply during evolution. */
  readonly mutation: readonly MutationInterface[];

  /** Number of iterations to run the training loop. */
  iterations: number;

  /** Enable verbose logging. Default is false. */
  verbose: boolean;

  enableRepetitiveTraining: boolean;

  /** The number of training samples per batch. */
  trainingBatchSize: number;

  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log: number;

  /** The directory to store the networks trace information (optional) */
  traceStore?: string;

  disableRandomSamples: boolean;

  /** The percentage of observations that will be used for training. Range 0..1 */
  trainingSampleRate: number;

  /** The target error to reach, once the network falls below this error, the process is stopped. Default: 0.05, Range 0..1 */
  targetError: number;
}

export type NeatOptions = Partial<NeatArguments>;
