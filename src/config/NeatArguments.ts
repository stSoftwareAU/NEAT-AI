import type { CrisprInterface } from "../../mod.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import type { CostName } from "../Costs.ts";
import type { SelectionInterface } from "../methods/Selection.ts";
import type { MutationInterface } from "../NEAT/MutationInterface.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";

/**
 * Concrete, fully-populated configuration shape used internally after defaults
 * are applied by `createNeatConfig()`.
 *
 * @internal
 */
export interface NeatArguments {
  /** The name of the cost function to use. */
  costName: CostName;

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

  /** List of DNA segments to attempt to inject */
  CRISPRs: CrisprInterface[];

  /** Custom cost function to use instead of predefined cost functions */
  customCost?: { filePath: string };

  /**
   * Enable feedback loop where the previous result feeds back into the next interaction.
   * Useful for time-series forecasting and recurrent neural networks.
   * More information: https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html
   *
   * ## Forward-only default
   * If this is **unset** (or `false`), the NEAT engine treats the run as **forward-only**:
   * - Recurrent connections (self-loops and feedback/backward connections) are **not selected**
   *   as mutation operations.
   *
   * Forward-only mode does **not** automatically strip legacy recurrent connections on load.
   * However, when a creature is mutated/bred in forward-only mode, recurrent connections are
   * removed so we "evolve away" from legacy recurrent structures over a few generations.
   *
   * To enable memory connections, set `feedbackLoop: true`.
   */
  feedbackLoop: boolean;

  /** List of observations to focus on (optional). */
  focusList: number[];

  /** Focus rate, defining how much attention to give to the focus list (optional). */
  focusRate: number;

  /**
   * Cost of growth (optional). Penalises complex networks and filters discovery
   * candidates: each new synapse consumes 1 x costOfGrowth, while each new
   * neuron consumes ~3 x costOfGrowth (two synapses plus the neuron body).
   */
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

  /**
   * The maximum +/- the bias will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumBiasAdjustmentScale: number;

  /**
   * The maximum +/- the weight will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumWeightAdjustmentScale: number;

  /** Determine how many neurons to select based on the sparseRatio. */
  sparseRatio: number;

  /** The ratio of breeding over all the creatures versus within the species */
  globalBreedingRate: number;

  /** The threshold for genetic compatibility between two creatures */
  geneticCompatibilityThreshold: number;

  /** Discovery Sample rate */
  discoverySampleRate: number;

  /**
   * Minimum expected improvement (0..1) that a discovery candidate must
   * achieve in order to be considered helpful. Defaults to 0.01 (1%).
   *
   * @see docs/DISCOVERY_GUIDE.md for the distributed discovery model
   */
  discoveryMinImprovementPercentage?: number;

  /**
   * Minimum multiplier of costOfGrowth that a discovery candidate's expected
   * improvement must exceed before evaluation. Defaults to 2.0.
   *
   * This filter is applied early in the discovery pipeline to exclude candidates
   * where expectedErrorReduction < (multiplier × costOfGrowth).
   *
   * For example, with costOfGrowth=0.0000001 and multiplier=2.0:
   * - Candidates with expected improvement < 0.0000002 are excluded
   * - This filters out candidates unlikely to provide meaningful benefit
   *
   * Set to 0 to disable this filter (only the positive-impact check will apply).
   */
  discoveryMinImprovementVsCostOfGrowthMultiplier: number;

  /**
   * Maximum minutes allocated to the recording phase before discovery advances to analysis.
   * Defaults to 1 minute (sufficient for ~50k records at 700 records/sec).
   */
  discoveryRecordTimeOutMinutes: number;

  /**
   * The maximum number of minutes allocated for the analysis phase (after recording completes).
   * Defaults to 10 minutes (tuned from production - was 3 minutes but caused timeouts).
   */
  discoveryAnalysisTimeoutMinutes: number;

  /** The number of observations per promise */
  discoveryBatchSize: number;

  /** The read buffer size, default 128k */
  discoveryBufferSize: number;

  /**
   * Maximum number of discovery samples to keep in memory before forcing a flush
   * to the Rust recorder. Lower values reduce peak memory usage at the cost of
   * more frequent I/O.
   */
  discoveryRustFlushRecords: number;

  /**
   * Estimated payload size threshold (in bytes) before flushing a Rust discovery
   * chunk.
   *
   * This prevents V8 hitting JSON.stringify() maximum string length limits when
   * recording for long periods with large creatures. Defaults to ~50 MiB.
   */
  discoveryRustFlushBytes: number;

  /**
   * The maximum number of neurons to analyse per discovery iteration.
   * Defaults to 6 (production-tuned - balances thoroughness with speed).
   */
  discoveryMaxNeurons: number;

  /** Drain promise chains every N batches during discovery recording to prevent memory buildup. Default: 10 */
  discoveryDrainEveryNBatches: number;

  /**
   * Optional ordered list of neuron UUIDs to prioritise during discovery analysis.
   * When provided, discovery focuses on these neurons before performing weighted selection.
   */
  discoveryFocusNeuronUUIDs: string[];

  /**
   * Disable the internal evaluation summary logging. When set to true, the library
   * will not log the evaluation summary, allowing external code to handle logging
   * using the exported formatting utilities. Defaults to false (library logs by default).
   */
  discoveryDisableEvaluationSummaryLogging: boolean;

  /** When enabled with creatureStore, saves population after each generation for crash recovery */
  checkpointEveryGeneration: boolean;

  /**
   * When true, disables cleanup of discovery temporary files (parquet files) after discovery completes.
   * Useful for debugging to examine the intermediate discovery data.
   * Defaults to false (cleanup enabled).
   */
  discoveryDisableCleanup: boolean;

  /**
   * Custom base directory for discovery temporary files.
   * By default, discovery uses `.discovery` in the current working directory.
   * Set this to redirect discovery files to a different location for testing/debugging.
   */
  discoveryBaseDirectory?: string;

  /**
   * When true, skips the record phase if parquet files already exist in the discovery directory.
   * Useful for debugging to re-run analysis on previously recorded data.
   * Defaults to false (always record).
   */
  discoverySkipRecordPhase: boolean;

  /**
   * Directory path to cache discovery failures.
   * When provided, discovery candidates that fail to improve the score are cached.
   * Subsequent discovery runs will skip candidates that match cached failures.
   *
   * Delete this directory when the training dataset changes to allow re-evaluation.
   *
   * Cache keys use the exponential component of weights/biases (formatted in scientific notation)
   * so only significant weight changes will trigger re-evaluation.
   */
  discoveryFailureCacheDir?: string;

  /**
   * Directory path to cache discovery successes.
   *
   * When provided, discovery candidates that improve the creature's score are
   * cached so they can be replayed later against a newer fittest creature.
   *
   * Delete this directory when the training dataset changes to avoid replaying
   * stale signals.
   */
  discoverySuccessCacheDir?: string;

  /**
   * Maximum number of cached successful candidates to re-score during replay.
   *
   * Defaults are applied in createNeatConfig().
   */
  discoveryReplayMaxSingles: number;

  /**
   * Maximum number of candidates to consider for pairwise replay combinations.
   *
   * Defaults are applied in createNeatConfig().
   */
  discoveryReplayMaxPairwise: number;

  /**
   * Maximum number of candidates to consider for triple replay combinations.
   *
   * Defaults are applied in createNeatConfig().
   */
  discoveryReplayMaxTriples: number;

  /**
   * Minimum candidates to evaluate per discovery category.
   */
  discoveryMinCandidatesPerCategory: Required<
    DiscoveryMinCandidatesPerCategory
  >;
}
