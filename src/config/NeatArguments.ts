import type { CrisprInterface } from "../../mod.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import type { CostName } from "@costs";
import type { SelectionInterface } from "@methods/Selection.ts";
import type { MutationInterface } from "@neat/MutationInterface.ts";
import type { RequiredPlateauDetectionConfig } from "@neat/PlateauDetector.ts";
import type { RequiredAdaptiveMutationThresholds } from "@config/AdaptiveMutationThresholds.ts";
import type { RequiredCompatibilityGatingConfig } from "@config/CompatibilityGatingConfig.ts";
import type { RequiredSelectionPressureConfig } from "@config/SelectionPressureConfig.ts";
import type { DiscoveryMinCandidatesPerCategory } from "@config/DiscoveryMinCandidatesPerCategory.ts";
import type { RequiredEnsembleDiversityConfig } from "@config/EnsembleDiversityConfig.ts";
import type { RequiredFineTunePopulationConfig } from "@config/FineTunePopulationConfig.ts";
import type { RequiredFitnessSharingConfig } from "@config/FitnessSharingConfig.ts";
import type { RequiredNoveltyConfig } from "@config/NoveltyConfig.ts";
import type { RequiredRandomImmigrantsConfig } from "@config/RandomImmigrantsConfig.ts";
import type { RequiredSpeciesStagnationConfig } from "@config/SpeciesStagnationConfig.ts";
import type { RequiredStabilityAdaptationConfig } from "@config/StabilityAdaptationConfig.ts";
import type { RequiredQuantumStepConfig } from "@config/QuantumStepConfig.ts";
import type { RequiredSquashEffectivenessConfig } from "@config/SquashEffectivenessConfig.ts";
import type { RequiredSquashBudgetConfig } from "@config/SquashBudgetConfig.ts";
import type { RequiredBiasRegularisationConfig } from "@config/BiasRegularisationConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { RandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type { TrainingEventCallback } from "@config/TrainingEvent.ts";
import type { RequiredPredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";
import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import type { RequiredWasmCacheConfig } from "@config/WasmCacheConfig.ts";
import type { RequiredWeightRegularisationConfig } from "@config/WeightRegularisationConfig.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import type { RequiredDiscoveryCacheConfig } from "@config/DiscoveryCacheConfig.ts";
import type { RequiredDiskSpaceConfig } from "@config/DiskSpaceConfig.ts";
import type { RequiredWorkerThreadCapConfig } from "@config/WorkerThreadCapConfig.ts";
import type { RequiredHyperparameterEvolutionConfig } from "@config/HyperparameterConfig.ts";
import type { RequiredAdaptivePopulationConfig } from "@config/AdaptivePopulationConfig.ts";
import type { RequiredCrossValidationConfig } from "@config/CrossValidationConfig.ts";
import type { RequiredDataFuzzingConfig } from "@config/DataFuzzingConfig.ts";
import type { RequiredDataQuantisationConfig } from "@config/DataQuantisationConfig.ts";
import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";
import type { RequiredOpdConfig } from "@config/OpdConfig.ts";
import type { RequiredSpecialistConfig } from "@config/SpecialistConfig.ts";
import type { RequiredParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";

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

  /**
   * Maximum number of CRISPRs to attempt per generation.
   *
   * Issue #1669: CRISPRs cycle across generations instead of being
   * permanently consumed. This option controls how many are tried
   * each generation. Defaults to 1 for backward compatibility.
   */
  maxCRISPRsPerGeneration: number;

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

  /**
   * Maximum number of retries when replacing a duplicate creature during
   * de-duplication. If exceeded, the mutated duplicate is accepted as-is
   * and a warning is logged. Default is 16.
   *
   * Issue #2286: Caps the previously unbounded retry loop (up to 48+
   * attempts) to reduce de-duplication cost at larger population sizes.
   */
  maxDedupRetries: number;

  /** Maximum number of minutes to run the training loop before exiting. */
  timeoutMinutes: number;

  /** Number of training sessions per generation. Default is 1. */
  trainPerGen: number;

  /**
   * Issue #3053: Maximum wall-clock minutes any single training task may run,
   * independent of the overall {@link timeoutMinutes} run budget.
   *
   * Without this cap an individual task inherited the entire remaining run
   * budget, so a stuck task could burn 10+ minutes before timing out. The
   * per-task budget is `min(remainingRunMinutes, trainingTaskTimeoutMinutes)`.
   *
   * Defaults to `5`. Set to `0` to disable the cap and restore the previous
   * "use the full remaining run budget" behaviour.
   */
  trainingTaskTimeoutMinutes: number;

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

  /**
   * Number of worker threads to use for parallel processing (min: 1).
   *
   * Issue #2244: Default is `navigator.hardwareConcurrency +` default
   * `heavyTaskWorkerCount` so the fast pool has at least one worker per logical
   * CPU when partitioning applies.
   */
  threads: number;

  /**
   * Number of workers dedicated to heavy tasks (discovery, training, recording).
   *
   * Issue #2243: Controls the partition between fast (fitness evaluation) and
   * heavy (discovery/training) worker pools. The remaining workers
   * (`threads - heavyTaskWorkerCount`) are dedicated to fast tasks.
   *
   * Must be >= 1 and < threads when threads > 2.
   * When threads <= 2, partitioning is disabled and all workers are shared.
   * Defaults to `2` (`DEFAULT_HEAVY_TASK_WORKER_COUNT` in `NeatConfig.ts`),
   * kept in sync with the default thread count offset in `createNeatConfig`.
   */
  heavyTaskWorkerCount: number;

  /** Selection method to use for choosing individuals for the next generation. */
  selection: SelectionInterface;

  /** List of mutation methods to apply during evolution. */
  readonly mutation: readonly MutationInterface[];

  /** Number of iterations to run the training loop. */
  iterations: number;

  /** Enable verbose logging. Default is false. */
  verbose: boolean;

  enableRepetitiveTraining: boolean;

  /**
   * Issue #2382: Skip scheduling training for a creature whose last N training
   * attempts all produced a higher error and no usable fine-tune variant. A
   * value of `0` disables the guard; the reference workload in #2382 logged
   * 217 rollback events per run, so the default is `2` so a creature has to
   * regress twice in a row before it is bypassed.
   */
  skipTrainingAfterConsecutiveRegressions: number;

  /**
   * Issue #2531: Maximum entries kept in the in-memory subnetwork hash index
   * that augments the discovery `SuccessCache` / `FailureCache` lookup. The
   * index is a bounded LRU keyed on the local 1-hop wire-pattern around a
   * focal neuron, which lets discovery short-circuit candidate ranking when
   * the same pattern has already been observed in the population.
   *
   * Defaults to 50,000. Set to 0 to disable the index entirely (in which
   * case discovery falls back to the existing exact-match cache lookup).
   */
  subnetworkIndexSize: number;

  /** The number of training samples per batch. */
  trainingBatchSize: number;

  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log: number;

  /** The directory to store the networks trace information (optional) */
  traceStore?: string;

  disableRandomSamples: boolean;

  /** The percentage of observations that will be used for training. Range 0..1 */
  trainingSampleRate: number;

  /**
   * Issue #3257: Fraction of the binary fitness corpus scored per creature
   * during the per-generation ranking pass. A deterministic, stratified
   * subsample (records skipped in one streaming pass — no second corpus on
   * disk) so scoring does proportionally less work while preserving rank
   * order. Range 0.0001..1; default 1 (score the full corpus — today's
   * behaviour, so production quality is unchanged unless opted in).
   */
  fitnessSampleRate: number;

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

  /**
   * Rate at which diversity-driven breeding occurs (Issue #2173).
   *
   * When triggered, the father is selected by maximum genetic distance from the
   * mother rather than by fitness. This ensures genetically diverse newcomers
   * (e.g., from Europa islands) periodically breed with fitter creatures.
   *
   * Range 0..1 where 0 disables diversity breeding and 1 always selects the
   * most genetically distant father. Defaults to 0 for backward compatibility.
   */
  diversityBreedingRate: number;

  /** The threshold for genetic compatibility between two creatures */
  geneticCompatibilityThreshold: number;

  /**
   * Threshold below which the input-weight crossover strategy is used
   * instead of standard neuron-level crossover (Issue #2175).
   *
   * When genetic compatibility between two parents falls below this value,
   * the offspring preserves the mother's full topology and blends
   * input/output connection weights from both parents. This produces
   * more meaningful gene transfer for genetically incompatible creatures
   * (e.g., creatures from different islands with no shared neuron UUIDs).
   *
   * Standard crossover (via editParentByIndex) is used for compatibility
   * values between this threshold and geneticCompatibilityThreshold.
   *
   * Range 0..1 where 0 disables input-weight crossover. Default: 0.1.
   */
  interSpeciesCrossoverThreshold: number;

  /**
   * Threshold for the synthetic-UUID alignment fallback in
   * `createCompatibleFather*` (Issues #2609, #2613, #2614).
   *
   * When the real-UUID overlap between mother and father (computed via
   * `getHiddenNeuronWireKeys()`) is **below** this value, the father's
   * hidden/constant neurons are aligned to the mother by recomputing
   * location-based synthetic UUIDs and matching either anchor. This gives
   * structurally similar but genetically incompatible parents real
   * crossover anchor points without persisting any synthetic identifiers.
   * When overlap is at or above the threshold, the new pass is a no-op
   * and the existing stable-UUID + connectivity-key alignment runs alone.
   *
   * Synthetic UUIDs are recomputed on demand and never written into a
   * `CreatureExport` — the gene swap continues to use real UUIDs only.
   *
   * Range 0..1. Default: 0.2. Set to 0 to disable the fallback.
   */
  syntheticAlignmentThreshold: number;

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
   * Minimum fraction (0–1) of the dataset that must be recorded before the
   * analysis phase runs when the record-phase timeout fires (Issue #3073).
   *
   * On a large dataset the record timeout can fire after only a fraction of
   * the expected records have been sampled, leaving focus-neuron coverage too
   * sparse for a meaningful analysis pass. When recording times out and the
   * achieved coverage is below this threshold, analysis is skipped with a clear
   * reason instead of burning the analysis budget on partial data.
   *
   * Defaults to 0.5 (50%). The guard only fires on a genuine timeout that left
   * part of a multi-file dataset unread — a recording that finished normally is
   * never affected. Set to 0 to disable the guard and always run analysis.
   */
  discoveryMinRecordCoverage: number;

  /**
   * The maximum number of minutes allocated for the analysis phase (after recording completes).
   * Defaults to 10 minutes (tuned from production - was 3 minutes but caused timeouts).
   */
  discoveryAnalysisTimeoutMinutes: number;

  /**
   * Absolute hard-deadline timestamp (epoch ms) for a single discovery
   * request (Issue #2898). Plumbed across the worker boundary in the per-call
   * frozen config built by `scheduleDiscovery` so every per-discovery deadline
   * — recording `timeoutTS`, the analysis extension, and `refreshAnalysisTimeout`
   * top-ups — can be clamped to the caller's absolute T+15 cap regardless of
   * worker-queue delay. Absent (undefined) when no `timeoutMinutes` is
   * configured, in which case clamping is a no-op and behaviour is unchanged.
   */
  discoveryHardDeadlineTS?: number;

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

  /**
   * Maximum number of neurons submitted to the Rust combined analysis in a
   * single FFI call. The analysis loop splits the focus list into chunks of
   * at most this size so progress can be checkpointed and logged between
   * chunks, and so a stall in Rust cannot consume the full analysis budget.
   *
   * Defaults to 2 (see Issue #2380). Set to 0 or a very large number to
   * disable chunking and submit the whole focus list in a single call (the
   * historical pre-#2380 behaviour).
   */
  discoveryAnalysisChunkSize: number;

  /**
   * Maximum milliseconds a single Rust combined-analysis chunk may take
   * before the analysis loop stops submitting further chunks for this
   * discovery cycle. Prevents one slow Rust call from consuming the full
   * analysis budget when per-neuron throughput has effectively stalled
   * (Issue #2380).
   *
   * Defaults to 120000 (2 minutes). Set to 0 to disable the stall guard.
   */
  discoveryAnalysisPerChunkMaxMs: number;

  /** Drain promise chains every N batches during discovery recording to prevent memory buildup. Default: 10 */
  discoveryDrainEveryNBatches: number;

  /**
   * Optional ordered list of neuron UUIDs to prioritise during discovery analysis.
   * When provided, discovery focuses on these neurons before performing weighted selection.
   */
  discoveryFocusNeuronUUIDs: number[];

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
   * When true, the discovery failure cache is bypassed for the top-K candidates
   * while a drought escalation is active (Issue #3072).
   *
   * The Rust discovery engine raises a drought signal — `noveltyEscalationActive`
   * or `creatureDroughtAlarm` — when a creature has plateaued and no candidates
   * have been accepted for an extended period. Normally `CandidateFiltering`
   * drops failure-cache hits before Phase-1 evaluation, which can starve a
   * plateaued creature of all candidates. When this option is enabled and a
   * drought signal is present, the highest-value cached candidates are
   * re-admitted for re-evaluation so the creature can escape the drought.
   *
   * Defaults to true.
   */
  discoveryFailureCacheBypassOnDrought: boolean;

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
   * Predictive Coding configuration.
   *
   * Issue #1553: Neuroscience-inspired learning framework where each layer
   * generates top-down predictions and learning is driven by minimising
   * prediction errors.
   */
  predictiveCoding: RequiredPredictiveCodingConfig;

  /**
   * WASM cache sizing configuration.
   *
   * Issue #1566: Controls the LRU caps for creature activation caching
   * and compilation template caching. Default `maxCachedActivations`
   * scales with `populationSize` to avoid eviction churn.
   */
  wasmCache: RequiredWasmCacheConfig;

  /**
   * Discovery cache eviction configuration.
   *
   * Issue #1701: Controls max entry counts and TTL-based eviction
   * for the on-disk success and failure discovery caches.
   */
  discoveryCache: RequiredDiscoveryCacheConfig;

  /**
   * Discovery disk space monitoring configuration.
   *
   * Issue #1703: Pre-flight and runtime disk space checks to warn
   * or abort discovery gracefully when disk space is insufficient.
   */
  discoveryDiskSpace: RequiredDiskSpaceConfig;

  /**
   * Heap memory monitoring configuration.
   *
   * Issue #1565: Proactive heap monitoring with graduated pressure
   * responses (warning vs critical) to evict WASM caches before OOM.
   */
  memory: RequiredMemoryConfig;

  /**
   * Worker thread cap configuration based on available memory.
   *
   * Issue #1569: When `maxMemoryMB` is set, the effective thread count
   * is capped to `floor(maxMemoryMB / estimatedMemoryPerWorkerMB)`.
   * When `maxMemoryMB` is 0 (default), no cap is applied.
   */
  workerThreadCap: RequiredWorkerThreadCapConfig;

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

  /**
   * Optional per-output range constraints.
   *
   * Issue #1620: When specified, creatures that produce outputs outside these
   * ranges receive a fitness penalty proportional to the excess. Each element
   * corresponds to one output neuron, in order.
   */
  outputRanges: ReadonlyArray<RequiredOutputRange>;

  /**
   * Optional callback for structured training lifecycle events.
   *
   * Issue #1615: When provided, this callback is invoked for each lifecycle
   * event (generation completion, plateau detection, discovery outcomes,
   * memory pressure, species adjustments). When not provided, no event
   * overhead is incurred.
   */
  onTrainingEvent?: TrainingEventCallback;

  /**
   * Per-creature hyperparameter evolution configuration.
   *
   * Issue #1863: When enabled, learning rate, mutation rates, and
   * regularisation strength are encoded as per-creature evolvable
   * parameters subject to mutation and crossover.
   */
  hyperparameterEvolution: RequiredHyperparameterEvolutionConfig;

  /**
   * Adaptive population sizing configuration.
   *
   * Issue #1863: When enabled, automatically adjusts population size
   * based on diversity metrics and convergence progress.
   */
  adaptivePopulation: RequiredAdaptivePopulationConfig;

  /**
   * Cross-validation configuration for fitness evaluation.
   *
   * Issue #1865: When enabled, training data is split into k folds
   * and fitness is evaluated as the average across held-out folds,
   * improving generalisation and reducing overfitting.
   */
  crossValidation: RequiredCrossValidationConfig;

  /**
   * Data fuzzing (noise injection) configuration.
   *
   * Issue #1900: When enabled, small random perturbations are added
   * to training data each iteration to prevent memorisation and
   * improve generalisation.
   */
  dataFuzzing: RequiredDataFuzzingConfig;

  /**
   * Data quantisation configuration.
   *
   * Issue #1901: When enabled, training data values are quantised to
   * a fixed number of discrete levels to prevent memorisation.
   * Deterministic complement to fuzzing (#1900).
   */
  dataQuantisation: RequiredDataQuantisationConfig;

  /**
   * Maximum number of concurrent discovery operations (Issue #2238).
   *
   * Replaces the binary guard that prevented scheduling any new discovery
   * while one was already running. Since discoveries are independent, they
   * can safely run in parallel on separate workers.
   *
   * Defaults to 1 for backward compatibility.
   */
  maxConcurrentDiscoveries: number;

  /**
   * Allow idle fast workers to be borrowed for heavy tasks (discovery/training)
   * when the heavy pool is saturated, and vice versa.
   *
   * Issue #2329: When the heavy pool is fully occupied and the fast pool has
   * idle workers, those idle fast workers can temporarily run discovery or
   * training tasks. This reduces idle CPU time and increases generations per
   * hour on high-core machines.
   *
   * Set to `false` to restore the strict pool separation from Issue #2244.
   * Defaults to `true`.
   */
  allowPoolBorrowing: boolean;

  /**
   * MCMC acceptance criterion configuration.
   *
   * Issue #2199: Temperature-based Metropolis-Hastings acceptance
   * for mutations. When enabled, worse-fitness moves are accepted
   * with decreasing probability as temperature cools, allowing
   * escape from local optima.
   */
  mcmc: RequiredMCMCConfig;

  /**
   * On-Policy Distillation breeding operator configuration (Issue #2528).
   *
   * When `breedRate > 0`, the breeding loop occasionally produces an
   * offspring by distilling the consensus output of K elite teachers
   * (default K = 3) into a freshly-initialised student creature using
   * on-policy gradient descent. Mirrors the DeepSeek V4 OPD stage.
   *
   * Defaults disable the operator (`breedRate: 0`) so existing
   * behaviour is preserved.
   */
  opd: RequiredOpdConfig;

  /**
   * Specialist sub-populations + ensemble distillation pipeline (Issue
   * #2530). Mirrors DeepSeek V4's two-stage post-training pipeline at
   * NEAT scale: dedicated specialist species per sub-task, periodically
   * distilled into a generalist via the OPD breed operator. Defaults
   * disable the pipeline (`mode: "off"`) so existing behaviour is
   * preserved.
   */
  specialist: RequiredSpecialistConfig;

  /**
   * Parallel batch creature evaluation configuration.
   *
   * Issue #1862: Controls topology-aware grouping and concurrency
   * limits for population fitness evaluation. Topology grouping
   * clusters same-structure creatures in the evaluation queue to
   * maximise WASM compilation cache hits across workers.
   */
  parallelEvaluation: RequiredParallelEvaluationConfig;

  /**
   * Per-role squash effectiveness tracker configuration.
   *
   * Issue #2457: Biases squash-function mutation toward activations that
   * have historically improved fitness in similar neuron roles. A "role"
   * is a stable bucket derived from layer index (input-adjacent / mid /
   * output-adjacent) plus fan-in bucket (low / medium / high).
   *
   * Configuration options:
   * - enabled: Whether biased squash sampling is active (default: true)
   * - minSamples: Minimum samples per role before the histogram is used
   *   (default: 20)
   * - explorationWeight: Fraction of biased draws kept uniform so under-
   *   sampled squashes still get tried (default: 0.2)
   */
  squashEffectiveness: RequiredSquashEffectivenessConfig;

  /**
   * Opt-in squash budget / activation prior (Issue #3263).
   *
   * When `allowedSquashes` is non-empty, mutation and neuron creation may only
   * introduce squashes from the allow-list, keeping populations cheap to score
   * and easier to keep GPU-hostable. Default is an empty allow-list (the free
   * 34-type mix), so existing runs are unaffected.
   */
  squashBudget: RequiredSquashBudgetConfig;

  /**
   * NEAT fitness sharing configuration.
   *
   * Issue #2453: When `enabled`, parent selection ranks creatures by
   * adjusted fitness (raw / speciesSize) and breeding slots are
   * allocated to species in proportion to their summed adjusted fitness.
   * `minSpeciesSlots` guarantees at least this many breeding slots to
   * every non-empty species so a numerous species cannot starve a small
   * but novel niche.
   *
   * Configuration options:
   * - enabled: Whether fitness sharing is active (default: true)
   * - minSpeciesSlots: Floor for per-species breeding slots (default: 1)
   */
  fitnessSharing: RequiredFitnessSharingConfig;

  /**
   * Novelty (behavioural-diversity) selection configuration (Issue #2932).
   * OFF by default. When `enabled`, ranking blends fitness with a
   * k-nearest-neighbour novelty score over per-creature behaviour
   * descriptors to escape deceptive local optima.
   * Configuration options:
   * - enabled: Whether novelty selection is active (default: false)
   * - weight: Blend weight in score' = (1-w)*fitness + w*novelty (default: 0.5)
   * - neighbours: k nearest neighbours for the novelty score (default: 15)
   * - archiveLimit: Maximum behaviours retained in the archive (default: 500)
   * - addThreshold: Minimum novelty to admit to the archive (default: 0)
   * - behaviourTag: Tag holding the behaviour descriptor (default: "behaviour")
   */
  novelty: RequiredNoveltyConfig;

  /**
   * Random-immigrant injection configuration (Issue #2933).
   * OFF by default. When `enabled`, on a detected plateau the weakest
   * non-elite creatures are replaced with freshly seeded genomes, adding
   * new genetic material to escape a stagnation trap. Elites are always
   * preserved.
   * Configuration options:
   * - enabled: Whether immigrant injection is active (default: false)
   * - injectionFraction: Fraction of non-elites replaced per injection (default: 0.1)
   * - triggerWindow: Generations on plateau before injecting (default: 5)
   * - cooldown: Generations to wait between injections (default: 10)
   */
  randomImmigrants: RequiredRandomImmigrantsConfig;

  /**
   * Species stagnation detection and breeding-budget reclamation
   * configuration.
   *
   * Issue #2454: Tracks per-species best raw fitness across generations.
   * Species that fail to improve over `haltWindow` generations have their
   * breeding share halved; species flat for `extinctionWindow` generations
   * are dropped from the breeding pool entirely. Reclaimed slots are
   * redistributed proportionally to the remaining species.
   *
   * Configuration options:
   * - enabled: Whether species stagnation detection is active (default: true)
   * - haltWindow: Generations before halving breeding share (default: 15)
   * - extinctionWindow: Generations before zeroing breeding share (default: 25)
   */
  speciesStagnation: RequiredSpeciesStagnationConfig;

  /**
   * Soft compatibility-gated cross-species breeding probability
   * (Issue #2455).
   *
   * Replaces the previous hard "lowest-compatibility father" pick on
   * the diversity-driven breeding path with a soft gate that accepts
   * each candidate with probability `compatibility ^ power`. Similar
   * architectures dominate while rare exploratory hybrids still
   * appear. After `maxDraws` rejections the gate falls back to the
   * lowest-compatibility candidate so selection always terminates.
   *
   * Configuration options:
   * - enabled: Whether the soft gate is active (default: true)
   * - power: Compatibility power exponent (default: 1.5; 0 recovers
   *   the prior lowest-compatibility behaviour)
   * - maxDraws: Bounded number of probabilistic draws before
   *   fallback (default: 3)
   */
  compatibilityGating: RequiredCompatibilityGatingConfig;

  /**
   * Selection-pressure configuration (Issue #2929).
   *
   * Exposes the previously hardcoded selection-pressure knobs so the
   * exploration/exploitation trade-off can be tuned per problem:
   * - power: POWER selection exponent (default: 4; higher biases harder
   *   towards top-ranked creatures)
   * - tournamentSize: fixed tournament size when adaptive sizing is off
   *   (default: 5)
   * - tournamentProbability: probability of picking the best participant
   *   (default: 0.5)
   * - adaptiveTournament: scale tournament size with population (default: true)
   * - adaptiveTournamentMinSize: floor for adaptive size (default: 3)
   * - adaptiveTournamentSqrtExponent: population scaling exponent
   *   (default: 0.5, i.e. square-root scaling)
   * - adaptiveTournamentCapFraction: cap as a fraction of population
   *   (default: 0.1)
   *
   * Every default reproduces the prior hardcoded behaviour exactly.
   */
  selectionPressure: RequiredSelectionPressureConfig;

  /**
   * Tolerate corrupt parents during breeding (Issue #2523).
   *
   * When `true` (default), the breeding loop skips parent candidates
   * whose serialised form fails to deserialise with a {@link
   * TopologyError}, logs a structured `[breed-skip-corrupt-parent]`
   * warning, and tries the next candidate. After exhausting all
   * candidates (capped at `min(10, populationSize)` retries), a
   * recoverable {@link BreedExhaustionError} is raised so the caller
   * can continue the rest of the batch.
   *
   * When `false`, the legacy fail-fast behaviour is restored: the first
   * `TopologyError` propagates out of the breeding loop (useful for
   * diagnostic runs that want to surface every corruption immediately).
   *
   * Non-`TopologyError` exceptions are always re-thrown unchanged.
   */
  tolerateCorruptParents: boolean;

  /**
   * Knob-tuning preset for inter-island DNA sharing (Issue #2492).
   *
   * Selects which bundle of defaults applies to the five inter-island
   * knobs (`diversityBreedingRate`, `interSpeciesCrossoverThreshold`,
   * `geneticCompatibilityThreshold`, and `compatibilityGating.*`).
   *
   * - `default` keeps the existing per-knob defaults (current behaviour).
   * - `aggressive` widens gating and increases diversity-driven breeding
   *   for very-distant donors (e.g. Europa→production cluster import).
   *   See `src/config/DnaSharingPreset.ts` for the exact preset values.
   *
   * Any explicit user value for a knob still wins over the preset default
   * — the preset only changes the default when the user did not set the
   * knob themselves.
   */
  dnaSharingMode: "default" | "aggressive";
}
