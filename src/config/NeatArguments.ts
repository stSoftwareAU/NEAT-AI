import type { CrisprInterface } from "../../mod.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import type { CostName } from "../Costs.ts";
import type { SelectionInterface } from "../methods/Selection.ts";
import type { MutationInterface } from "../NEAT/MutationInterface.ts";
import type { RequiredPlateauDetectionConfig } from "../NEAT/PlateauDetector.ts";
import type { RequiredAdaptiveMutationThresholds } from "./AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { RequiredEnsembleDiversityConfig } from "./EnsembleDiversityConfig.ts";
import type { RequiredFineTunePopulationConfig } from "./FineTunePopulationConfig.ts";
import type { RequiredStabilityAdaptationConfig } from "./StabilityAdaptationConfig.ts";
import type { RequiredQuantumStepConfig } from "./QuantumStepConfig.ts";
import type { RequiredBiasRegularisationConfig } from "./BiasRegularisationConfig.ts";
import type { Logger } from "../utils/Logger.ts";
import type { RandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import type { RequiredWeightRegularisationConfig } from "./WeightRegularisationConfig.ts";

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

  /**
   * Discovery sample rate: the fraction of training records sampled for structural analysis.
   * Defaults to 0.2 (20%) — increased from 0.05 in #1386 for better statistical coverage.
   * Set to -1 to disable discovery entirely.
   */
  discoverySampleRate: number;

  /**
   * Maximum minutes allocated to the recording phase before discovery advances to analysis.
   * Defaults to 5 minutes (sufficient for ~210k records at 700 records/sec).
   * Increased from 1 minute in #1386 to accommodate the higher default sample rate.
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
   * Base directory for discovery caching (Issue #997).
   *
   * When provided, this serves as the base directory for discovery cache operations:
   * - Success cache is stored in `{discoveryCacheDir}/success/`
   * - Failure cache is stored in `{discoveryCacheDir}/failure/`
   *
   * Additionally, when a new "fittest" creature is found during evolution,
   * the cached discoveries are replayed against it in a non-blocking manner.
   * This allows learnings from previous discovery runs to be applied when
   * evolution restarts.
   *
   * The explicit `discoverySuccessCacheDir` and `discoveryFailureCacheDir`
   * options take precedence over paths derived from this base directory.
   *
   * Delete this directory when the training dataset changes materially.
   */
  discoveryCacheDir?: string;

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
   * When true, replay will explicitly verify baseline/candidate scores against the
   * provided dataset directory (dataDir) and only report improvements that are
   * confirmed on the current data.
   *
   * Defaults to false to preserve legacy performance/behaviour.
   */
  discoveryReplayVerifyScores: boolean;

  /**
   * Bounded concurrency for replay scoring when score verification is enabled.
   *
   * Defaults to max(availableCores, 8) when verification is enabled.
   */
  discoveryReplayConcurrency: number;

  /**
   * When score verification is enabled, controls whether replay should report
   * baseline score drift (claimed vs actual) in the result payload.
   *
   * Defaults to true when verification is enabled.
   */
  discoveryReplayRescoreBaseline: boolean;

  /**
   * When true, replay records and returns simple timing diagnostics so callers can
   * see where time is being spent (workers, rescoring, applying candidates, etc.).
   *
   * Defaults to false.
   */
  discoveryReplayDiagnostics: boolean;

  /**
   * Maximum minutes allocated for discovery replay operations.
   *
   * When the evolution loop schedules a replay, it passes the remaining evolution
   * time (if set). This option provides a default timeout when no evolution time
   * constraint is active, or caps the replay time when specified.
   *
   * Set to 0 to disable replay timeout (not recommended for production).
   * Defaults to 5 minutes.
   */
  discoveryReplayTimeoutMinutes: number;

  /**
   * Minimum remaining time (in minutes) required before starting discovery replay.
   *
   * If the remaining evolution time falls below this threshold, replay is skipped
   * to avoid hanging the process. This ensures meaningful time remains for replay
   * to complete.
   *
   * Defaults to 1 minute.
   */
  discoveryReplayMinTimeMinutes: number;

  /**
   * Minimum candidates to evaluate per discovery category.
   */
  discoveryMinCandidatesPerCategory: Required<
    DiscoveryMinCandidatesPerCategory
  >;

  /**
   * Adaptive mutation rate thresholds based on creature size.
   *
   * Issue #1037: Large creatures have a massive search space. Adding more
   * structure (ADD_NODE, ADD_CONNECTION) makes the search space exponentially
   * larger while rarely improving fitness.
   *
   * This configuration allows the mutation strategy to adapt based on
   * creature size:
   * - Small creatures (< medium threshold): Normal topology mutation rates
   * - Medium creatures (>= medium, < large): Reduced topology expansion
   * - Large creatures (>= large threshold): Focus on MOD_WEIGHT, MOD_BIAS
   */
  adaptiveMutationThresholds: RequiredAdaptiveMutationThresholds;

  /**
   * Fitness plateau detection configuration.
   *
   * Issue #1039: Evolution can stagnate when the population gets stuck in a
   * local optimum. Plateau detection monitors fitness improvement over a
   * sliding window and applies stagnation responses when improvement falls
   * below a threshold.
   *
   * Stagnation responses include:
   * - Increased mutation rate (via responseMutationMultiplier)
   * - Encouraging more diverse crossover (between different species)
   *
   * Configuration options:
   * - windowSize: Number of generations to consider (default: 10)
   * - minImprovementRate: Minimum required improvement rate (default: 0.001 = 0.1%)
   * - responseMutationMultiplier: Mutation rate multiplier on plateau (default: 2.0)
   * - enabled: Whether plateau detection is active (default: false)
   */
  plateauDetection: RequiredPlateauDetectionConfig;

  /**
   * Stability-based mutation adaptation configuration.
   *
   * Issue #1307: Reduce brittleness by adapting mutation rates based on
   * validation stability. This tracks mutation outcomes per creature and
   * adjusts mutation strategies for creatures producing brittle offspring.
   *
   * When enabled:
   * - Tracks success rate of recent mutations per creature
   * - Distinguishes between "failed validation" vs "passed but brittle"
   * - Reduces mutation magnitude for creatures producing brittle offspring
   * - Increases exploration for creatures with stable mutations
   * - Factors stability into parent selection during breeding
   *
   * Configuration options:
   * - enabled: Whether stability adaptation is active (default: false)
   * - stabilityWindowSize: Rolling window size for tracking outcomes (default: 20)
   * - brittlenessThreshold: Threshold for considering a creature brittle (default: 0.3)
   * - brittleReductionFactor: Mutation rate reduction for brittle creatures (default: 0.5)
   * - selectionStabilityWeight: Weight given to stability in parent selection (default: 0.2)
   */
  stabilityAdaptation: RequiredStabilityAdaptationConfig;

  /**
   * Weight regularisation configuration during mutation.
   *
   * Issue #1309: Reduce brittleness by regularising weight mutations to prevent
   * extreme values that cause brittleness. Weight mutations can produce extreme
   * values that create near-constant outputs, amplify noise excessively, or
   * cause saturation in downstream neurons.
   *
   * When enabled:
   * - Enforces hard limits on maximum absolute weight
   * - Enforces hard limits on maximum weight change per mutation
   * - Applies L2-style regularisation biasing towards smaller weights
   * - Prefers smaller weight changes over large jumps
   *
   * Configuration options:
   * - enabled: Whether weight regularisation is active (default: true)
   * - maxAbsoluteWeight: Maximum absolute weight value (default: 100)
   * - maxWeightChange: Maximum change per mutation (default: 10)
   * - l2Strength: Strength of L2 bias towards smaller weights (default: 0.1)
   * - preferSmallChanges: Whether to prefer smaller changes (default: true)
   * - smallChangeScale: Scale factor for small change preference (default: 0.5)
   */
  weightRegularisation: RequiredWeightRegularisationConfig;

  /**
   * Bias regularisation configuration during mutation.
   *
   * Issue #1416: Evolve towards "safe" biases by regularising bias mutations
   * to prevent extreme values that cause exploding activations. Bias mutations
   * can produce extreme values that cause saturation, amplify noise, or
   * create near-constant outputs in downstream neurons.
   *
   * When enabled:
   * - Enforces hard limits on maximum absolute bias
   * - Enforces hard limits on maximum bias change per mutation
   * - Applies L2-style regularisation biasing towards smaller biases
   * - Prefers smaller bias changes over large jumps
   *
   * Configuration options:
   * - enabled: Whether bias regularisation is active (default: true)
   * - maxAbsoluteBias: Maximum absolute bias value (default: 100)
   * - maxBiasChange: Maximum change per mutation (default: 10)
   * - l2Strength: Strength of L2 bias towards smaller biases (default: 0.1)
   * - preferSmallChanges: Whether to prefer smaller changes (default: true)
   * - smallChangeScale: Scale factor for small change preference (default: 0.5)
   */
  biasRegularisation: RequiredBiasRegularisationConfig;

  /**
   * Ensemble diversity scoring configuration for species management.
   *
   * Issue #1310: Reduce brittleness by encouraging species diversity to avoid
   * over-reliance on "brilliant but brittle" high-performers.
   *
   * When enabled:
   * - Measures diversity within species using weight variance, squash entropy,
   *   and topology diversity
   * - Adjusts fitness scores to reward diversity contribution
   * - Optionally protects diverse low-performers from culling
   * - Triggers cross-species breeding when diversity is too low
   * - Prefers diverse parent combinations during selection
   *
   * Configuration options:
   * - enabled: Whether ensemble diversity scoring is active (default: false)
   * - diversityWeight: Weight given to diversity in fitness adjustment (default: 0.15)
   * - weightVarianceWeight: Weight for weight variance metric (default: 0.4)
   * - squashEntropyWeight: Weight for squash entropy metric (default: 0.3)
   * - topologyDiversityWeight: Weight for topology diversity metric (default: 0.3)
   * - protectDiverseLowPerformers: Protect diverse creatures from culling (default: false)
   * - crossSpeciesBreedingThreshold: Trigger cross-species breeding below this (default: 0.2)
   */
  ensembleDiversity: RequiredEnsembleDiversityConfig;

  /**
   * Quantum step sizing configuration for memetic fine-tuning.
   *
   * Issue #1330: Adaptive step sizing based on training progress improves
   * convergence - larger steps when far from optimum, smaller steps when
   * fine-tuning near convergence.
   *
   * Configuration options:
   * - minStep: Minimum quantum step size (default: 0.000_000_1)
   * - maxStep: Maximum quantum step size (default: 0.001)
   * - errorScale: Scale factor for error-based adaptation (default: 10)
   */
  quantumStep: RequiredQuantumStepConfig;

  /**
   * Adaptive fine-tuning population sizing configuration.
   *
   * Issue #1323: Dynamically adjusts the fine-tuning population size based
   * on how successful fine-tuning has been in recent generations.
   *
   * When fine-tuning produces improvements, more resources are allocated to it.
   * When fine-tuning consistently fails, the population size decreases.
   *
   * Configuration options:
   * - minPopulationFraction: Minimum fraction of population for fine-tuning (default: 0.1)
   * - maxPopulationFraction: Maximum fraction of population for fine-tuning (default: 0.4)
   * - basePopulationFraction: Starting fraction before success data exists (default: 0.2)
   * - successRateWindow: Number of recent generations to consider (default: 10)
   */
  fineTunePopulation: RequiredFineTunePopulationConfig;

  /**
   * Structured logger instance for NEAT-AI output.
   *
   * Issue #1398: Consumers can inject a custom logger for integration
   * with external logging systems. When not provided, defaults to a
   * console-based logger at "info" level.
   */
  logger: Logger;

  /**
   * Random number generator instance for reproducible evolution.
   *
   * Issue #1400: All stochastic operations (mutation, selection, breeding,
   * shuffling) use this RNG instead of `Math.random()`. When a `seed` is
   * provided via NeatOptions, a deterministic xoshiro256** PRNG is used;
   * otherwise an unseeded wrapper around `Math.random()` preserves backward
   * compatibility.
   */
  rng: RandomNumberGenerator;
}
