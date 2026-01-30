import { assert, fail } from "@std/assert";
import { yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { emptyDirSync } from "@std/fs";
import { getTag, type TagInterface } from "@stsoftware/tags/mod";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "./architecture/CreatureInterfaces.ts";
import { CreatureState } from "./architecture/CreatureState.ts";
import { CreatureUtil } from "./architecture/CreatureUtils.ts";
import { creatureValidate } from "./architecture/CreatureValidate.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "./architecture/DataSet.ts";
import type { DiscoverRecord } from "./architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Neuron } from "./architecture/Neuron.ts";
import type { NeuronTrace } from "./architecture/NeuronInterfaces.ts";
import { calculate as calculateScore } from "./architecture/Score.ts";
import { Synapse } from "./architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./architecture/SynapseInterfaces.ts";
import { dataFiles } from "./architecture/Training.ts";
import type { MemeticInterface } from "./blackbox/MemeticInterface.ts";
import { compactCreature } from "./compact/CompactCreature.ts";
import { removeHiddenNeuron } from "./compact/CompactUtils.ts";
import { createNeatConfig } from "./config/NeatConfig.ts";
import type { NeatOptions } from "./config/NeatOptions.ts";
import { Costs } from "./Costs.ts";
import type { CostInterface } from "./costs/CostInterface.ts";
import { Activations } from "./methods/activations/Activations.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { Neat } from "./NEAT/Neat.ts";
import { makeCreatureActivationFunction } from "./optimize/MakeCreatureActivationFunction.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "./propagate/BackPropagation.ts";
import { SparseConfig } from "./propagate/sparse/SparseConfig.ts";
import { upgradeOne } from "./upgrade/UpgradeOne.ts";
import { CreatureExportBuilder } from "./utils/CreatureExportBuilder.ts";
import { mergeTagsByNameValue } from "./utils/TagUtils.ts";
import {
  type DiscoveryDirResult,
  DiscoveryRunner,
  type DiscoveryRunnerLike,
} from "./discovery/DiscoveryRunner.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayRunner,
  type DiscoveryReplayRunnerLike,
} from "./discovery/DiscoveryReplayRunner.ts";
import {
  compileCreatureToWasm,
  ensureWasmActivation,
  isWasmActivationAvailable,
  resolveWasmSquashName,
  WasmCreatureActivation,
} from "./wasm/mod.ts";

interface CreatureOptions {
  semanticVersion?: string;
  lazyInitialization?: boolean;
  layers?: { squash?: string; count: number }[];
  outputLayer?: {
    squash?: string;
  };
}

/**
 * Cached score components to avoid recalculating on every score calculation.
 * Issue #1023: Performance optimisation for large creatures.
 * Issue #1011: Cache weight/bias statistics incrementally.
 * Issue #1045: Added totalWeightBias and countWeightBias for incremental updates.
 */
export interface CachedScoreComponents {
  /** Number of hidden neurons (neurons.length - input - output) */
  hiddenNeuronCount: number;
  /** Total complexity penalty from squash functions */
  squashComplexityPenalty: number;
  /** Maximum absolute value among all weights and biases */
  maxWeightBias: number;
  /** Average absolute value among all weights and biases */
  avgWeightBias: number;
  /**
   * Sum of absolute values of all weights and biases.
   * Issue #1045: Required for incremental updates.
   */
  totalWeightBias: number;
  /**
   * Count of weights and biases (synapses.length + non-input neurons).
   * Issue #1045: Required for incremental updates.
   */
  countWeightBias: number;
}

/** Issue #1229: When set, allow JS activation path (tests / verification). */
function isUseJsActivationEnvSet(): boolean {
  try {
    const v = Deno.env.get("NEAT_AI_USE_JS_ACTIVATION")?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  } catch {
    return false;
  }
}

/**
 * Creature Class
 *
 * The Creature class represents an AI entity within the NEAT (NeuroEvolution of Augmenting Topologies) framework.
 * It encapsulates the neural network structure and its associated behaviors, including activation, mutation,
 * propagation, and evolution processes. This class is integral to the simulation and evolution of neural networks.
 */
export class Creature implements CreatureInternal {
  /**
   * The unique identifier of this creature.
   * @type {string | undefined}
   */
  uuid?: string;

  /**
   * The number of input neurons.
   * @type {number}
   */
  input: number;

  /**
   * The number of output neurons.
   * @type {number}
   */
  output: number;

  /**
   * The array of neurons within this creature.
   * @type {Neuron[]}
   */
  neurons: Neuron[];

  /**
   * Optional tags associated with the creature.
   * @type {TagInterface[] | undefined}
   */
  tags?: TagInterface[];

  /**
   * The score of the creature, used for evaluating fitness.
   * @type {number | undefined}
   */
  score?: number;

  /**
   * The array of synapses (connections) between neurons.
   * @type {Synapse[]}
   */
  synapses: Synapse[];

  /** Records the origins of this creature. */
  memetic?: MemeticInterface;

  /**
   * The state of the creature, managing the internal state and activations.
   * @type {CreatureState}
   */
  readonly state: CreatureState = new CreatureState(this);

  private cacheTo = new Map<number, Synapse[]>();
  private cacheFrom = new Map<number, Synapse[]>();
  private cacheSelf = new Map<number, Synapse[]>();
  private cacheFocus: Map<number, boolean> = new Map();

  /**
   * The focus list that the focus cache was built for.
   * Issue #1100: Track focus list to detect when cache should be invalidated.
   * If undefined, no focus cache has been built yet.
   */
  private cacheFocusList: number[] | undefined = undefined;

  /**
   * Secondary index of synapses sorted by `to` field.
   * Enables O(log n) binary search for inward connections instead of O(n) linear scan.
   * Issue #1010: Performance optimisation for large creatures.
   */
  private synapsesIndexedByTo: Synapse[] | null = null;

  /**
   * Cached Set of existing connections as "from-to" strings.
   * Enables O(1) lookup for connection existence checks.
   * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
   */
  private connectionSet: Set<string> | null = null;

  /**
   * Cached array of available connection pairs [from, to].
   * Enables O(1) retrieval of available connections after first computation.
   * Issue #1098: Performance optimisation for AddConnection mutation.
   */
  private availableConnectionsCache: [number, number][] | null = null;

  /**
   * Cached Set of hidden neuron UUIDs.
   * Enables O(1) lookup for genetic compatibility checks.
   * Issue #1032: Performance optimisation for genetic compatibility checks.
   */
  private hiddenNeuronUUIDs: Set<string> | null = null;

  /** The version of this creature */
  public semanticVersion: string;

  /**
   * When true, this creature is intended to remain forward-only (no recurrent connections).
   *
   * Recurrent connections include:
   * - self-loops (from === to)
   * - feedback/backward connections (from > to)
   * This flag survives export/import.
   */
  public forwardOnly?: boolean;

  /**
   * Cached score components to avoid recalculating structure-dependent values
   * on every score calculation. Invalidated when structure changes.
   * Issue #1023: Performance optimization for large creatures.
   */
  public cachedScoreComponents?: CachedScoreComponents;

  /**
   * Cached topology hash for this creature.
   * The topology hash identifies creatures with identical network structure
   * (neurons and connections) regardless of weights and biases.
   * Issue #1016: Performance optimisation for evaluation deduplication.
   */
  public topologyHash?: string;

  /**
   * Cached output buffer for activate() and activateAndTrace() methods.
   *
   * NOTE: Output buffer reuse was removed because it provided no measurable
   * performance benefit in our benchmarks and is easy to misuse (callers may
   * accidentally retain the returned array across calls).
   */
  // (left intentionally unused for backwards-compat doc history)

  /**
   * Cached WASM activation instance for this creature.
   * Lazily compiled on first WASM activation request.
   * Issue #1118: WASM Migration Phase 1 - Add WASM activation option.
   */
  private cachedWasmActivation?: WasmCreatureActivation;

  /**
   * Cached WASM eligibility status for this creature.
   * True if all neurons use WASM-supported squash functions.
   * Invalidated on structural changes.
   * Issue #1118: WASM Migration Phase 1 - Add WASM activation option.
   */
  private wasmEligibilityCache?: boolean;

  /**
   * Debug mode flag.
   * @type {boolean}
   */
  DEBUG: boolean = ((globalThis as unknown) as { DEBUG: boolean }).DEBUG;

  /**
   * Constructs a new Creature instance.
   *
   * @param {number} input - The number of input neurons.
   * @param {number} output - The number of output neurons.
   * @param {Object} [options] - Configuration options for initializing the creature.
   * @param {boolean} [options.lazyInitialization=false] - If true, the creature will not be initialized immediately.
   * @param {Object[]} [options.layers] - Optional layers configuration.
   */
  constructor(
    input: number,
    output: number,
    options: CreatureOptions = {},
  ) {
    this.input = input;
    this.output = output;
    this.neurons = [];
    this.synapses = [];

    this.tags = undefined;
    this.score = undefined;
    this.semanticVersion = options.semanticVersion ?? "0.0.1";
    // Forward-only is a hard invariant for 4.x+ creatures.
    // Setting this before `initialize()` prevents `fix()` from introducing
    // recurrent connections (eg self-loops) during construction.
    const major = Number.parseInt(
      this.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    this.forwardOnly = Number.isFinite(major) && major >= 4 ? true : undefined;

    if (!options.lazyInitialization) {
      this.initialize(options);

      if (this.DEBUG) {
        creatureValidate(this);
      }
    }
  }

  /**
   * Dispose of the creature and all held memory.
   */
  public dispose() {
    this.clearState();
    this.clearCache();
    this.clearFocusCache();
    this.disposeWasm(); // Issue #1118: Clean up WASM resources
    this.synapses.length = 0;
    this.neurons.length = 0;
  }

  /**
   * Clear the cache of connections.
   *
   * @param {number} [from=-1] - The starting index of the cache to clear.
   * @param {number} [to=-1] - The ending index of the cache to clear.
   */
  public clearCache(from: number = -1, to: number = -1) {
    if (from === -1 || to === -1) {
      this.cacheTo.clear();
      this.cacheFrom.clear();
      this.cacheSelf.clear();
      // Invalidate secondary index on full cache clear
      this.synapsesIndexedByTo = null;
      this.inwardCacheMissCount = 0;
      // Invalidate connection set on full cache clear
      this.connectionSet = null;
      // Invalidate hidden neuron UUIDs cache on full cache clear
      // Issue #1032: Performance optimisation for genetic compatibility checks
      this.hiddenNeuronUUIDs = null;
      // Invalidate available connections cache on full cache clear
      // Issue #1098: Performance optimisation for AddConnection mutation
      this.availableConnectionsCache = null;
    } else {
      this.cacheTo.delete(to);
      this.cacheFrom.delete(from);
      this.cacheSelf.delete(from);
      // Invalidate secondary index on partial clear (structure changed)
      this.synapsesIndexedByTo = null;
      this.inwardCacheMissCount = 0;
      // Invalidate connection set on partial clear (structure changed)
      this.connectionSet = null;
      // Invalidate hidden neuron UUIDs cache on partial clear (structure changed)
      // Issue #1032: Performance optimisation for genetic compatibility checks
      this.hiddenNeuronUUIDs = null;
      // Invalidate available connections cache on partial clear (structure changed)
      // Issue #1098: Performance optimisation for AddConnection mutation
      this.availableConnectionsCache = null;
    }
    // Issue #1100: Do NOT clear focus cache on structural changes.
    // Focus cache validity depends on the focus list, not on structure.
    // This allows focus cache to be reused across mutation batches when
    // the focus list remains constant.
    this.invalidateScoreCache();
  }

  /**
   * Clear the focus cache.
   *
   * Issue #1100: Separate focus cache clearing from structural cache clearing.
   * The focus cache maps neuron indices to focus status (true/false).
   * It should be cleared when the focus list changes, not when structure changes.
   *
   * Call this method when:
   * - The focus list changes between mutations
   * - You want to force recalculation of focus status
   *
   * Do NOT call this method:
   * - On structural changes (neurons/synapses added/removed)
   * - Between mutations in the same batch with constant focus list
   */
  public clearFocusCache(): void {
    this.cacheFocus.clear();
    this.cacheFocusList = undefined;
  }

  /**
   * Invalidate the cached score components.
   * Should be called whenever structure changes (neurons/synapses added/removed,
   * squash functions changed).
   * Issue #1023: Performance optimization for large creatures.
   */
  public invalidateScoreCache() {
    this.cachedScoreComponents = undefined;
    // Issue #1118: Invalidate WASM eligibility cache on structural changes
    // (squash functions may have changed)
    this.wasmEligibilityCache = undefined;
  }

  private initialize(options: {
    layers?: { squash?: string; count: number }[];
    outputLayer?: {
      squash?: string;
    };
  }) {
    let fixNeeded = false;
    // Create input neurons
    for (let i = this.input; i--;) {
      const type = "input";
      const neuron = new Neuron(`input-${this.input - i - 1}`, type, 0, this);
      neuron.index = this.neurons.length;
      this.neurons.push(neuron);
    }

    if (options.layers) {
      let lastStartIndx = 0;
      let lastEndIndx = this.neurons.length - 1;

      for (let i = 0; i < options.layers.length; i++) {
        const layer = options.layers[i];

        for (let j = 0; j < layer.count; j++) {
          let tmpSquash = layer.squash ?? "*";
          if (tmpSquash === "*") {
            tmpSquash = Activations.pickRandomSquash();
            fixNeeded = true;
          }

          const neuron = new Neuron(
            crypto.randomUUID(),
            "hidden",
            Math.random() * 0.2 - 0.1,
            this,
            tmpSquash,
          );
          neuron.index = this.neurons.length;
          this.neurons.push(neuron);
        }

        const tmpOutput = this.output;
        this.output = 0;

        for (let k = lastStartIndx; k <= lastEndIndx; k++) {
          for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
            this.connect(k, l, Synapse.randomWeight());
          }
        }
        this.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.neurons.length - 1;
      }

      // Create output neurons
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        let squash = Activations.pickRandomSquash();
        if (options.outputLayer?.squash) {
          squash = options.outputLayer.squash;
        } else {
          fixNeeded = true;
        }
        const neuron = new Neuron(
          `output-${indx}`,
          type,
          Math.random() * 0.2 - 0.1,
          this,
          squash,
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
      }

      for (let k = lastStartIndx; k <= lastEndIndx; k++) {
        for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
          this.connect(k, l, Synapse.randomWeight());
        }
      }
    } else {
      // Create output neurons
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const neuron = new Neuron(
          `output-${indx}`,
          type,
          Math.random() * 0.2 - 0.1,
          this,
          Activations.pickRandomSquash(),
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
        fixNeeded = true;
      }

      // Connect input neurons with output neurons directly
      for (let i = 0; i < this.input; i++) {
        for (let j = this.input; j < this.output + this.input; j++) {
          /** https://stats.stackexchange.com/a/248040/147931 */
          const weight = Math.random() * this.input *
            Math.sqrt(2 / this.input);
          this.connect(i, j, weight);
        }
      }
    }

    if (fixNeeded) {
      this.fix();
    }
  }

  /**
   * Clear the context of the creature.
   */
  clearState() {
    delete this.score;
    this.state.clear();
    delete this.creatureActivationResult;
    // Clear WASM cache - structure may have changed
    // Issue #1118: WASM Migration Phase 1
    this.disposeWasm();
  }

  private creatureActivationFunction?: () => undefined;
  private creatureActivationResult?: {
    inlineFunction: () => undefined;
    inlineText: string;
    squashList: string[];
  };
  private prepareNeurons() {
    if (this.state.preparedNeurons) {
      return;
    }

    this.creatureActivationResult = makeCreatureActivationFunction(this);
    this.creatureActivationFunction =
      this.creatureActivationResult.inlineFunction;
    for (let i = this.input, len = this.neurons.length; i < len; i++) {
      this.neurons[i].prepare();
    }
    this.state.preparedNeurons = true;
  }

  /**
   * Activates the creature and traces the activity.
   *
   * @param {Float32Array} input - The input values for the creature.
   * @param {boolean} feedbackLoop - Whether to use a feedback loop during activation.
   * @param {SparseConfig} sparseConfig - The sparse configuration for tracing.
   * @param {boolean} [useJs=false] - Optional. When true, uses JavaScript activation (verification/debug only).
   *   Callers do not need to set this; the library uses the best available backend internally (Issue #1256).
   * @returns {Float32Array} The output values after activation.
   */
  activateAndTrace(
    input: Float32Array,
    feedbackLoop: boolean,
    sparseConfig: SparseConfig,
    useJs: boolean = false,
  ): Float32Array {
    // Issue #1193: For forward-only creatures, feedbackLoop has no effect since there
    // are no recurrent connections. Normalize to false for consistency and performance.
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;

    // Issue #1256: WASM is the default; useJs is for verification/debug only. No caller-facing backend API.
    const forceJs = useJs;
    if (!forceJs) {
      this.requireWasmOrThrow();
      if (this.canUseWasm()) {
        return this.activateAndTraceWasm(
          input,
          effectiveFeedbackLoop,
          sparseConfig,
        );
      }
    }

    // JS activation (verification only)
    this.prepareNeurons();
    const activations = this.state.makeActivation(input, effectiveFeedbackLoop);

    const neurons = this.neurons;
    const len = neurons.length;

    for (let i = this.input; i < len; i++) {
      const n = neurons[i];
      const result = sparseConfig.traceNeeded(n.uuid)
        ? n.activateAndTraceNeuron()
        : n.activateNeuron();

      // Back propagation uses `hintValue` as the best available estimate of the
      // neuron's pre-squash value. We store it for any neuron that may be
      // propagated through (selected neurons + their paths) to avoid unstable
      // inverse/derivative calculations.
      if (sparseConfig.propagateNeeded(n.uuid)) {
        this.state.node(n.index).hintValue = result.value;
      }
    }

    const lastHiddenNode = len - this.output;
    return this.extractOutputs(activations, lastHiddenNode);
  }

  /**
   * Activates the creature without calculating traces.
   *
   * @param {Float32Array} input - The input values for the creature.
   * @param {boolean} [feedbackLoop=false] - Whether to use a feedback loop during activation.
   * @param {boolean} [useJs=false] - Optional. When true, uses JavaScript activation (verification/debug only).
   *   Callers do not need to set this; the library uses the best available backend internally (Issue #1256).
   * @returns {Float32Array} The output values after activation.
   */
  activate(
    input: Float32Array,
    feedbackLoop: boolean = false,
    useJs: boolean = false,
  ): Float32Array {
    // Issue #1193: For forward-only creatures, feedbackLoop has no effect since there
    // are no recurrent connections. Normalize to false for consistency and performance.
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;

    // Issue #1256: WASM is the default; useJs is for verification/debug only. No caller-facing backend API.
    const forceJs = useJs;
    if (!forceJs) {
      this.requireWasmOrThrow();
      if (this.canUseWasm()) {
        return this.activateWasm(input, effectiveFeedbackLoop);
      }
    }

    // JS activation (verification only)
    this.prepareNeurons();
    const activations = this.state.makeActivation(input, effectiveFeedbackLoop);

    try {
      this.creatureActivationFunction!();
    } catch (e) {
      console.error("Error in creature activation function", e);
      const functionBody = this.creatureActivationResult?.inlineText ??
        "Function body not available";
      Deno.writeTextFileSync(".error-function.js", functionBody);
      throw e;
    }

    const lastHiddenNode = this.neurons.length - this.output;
    return this.extractOutputs(activations, lastHiddenNode);
  }

  /**
   * Check if this creature can use WASM activation.
   * Returns true if WASM is available and all squash functions are supported.
   * Issue #1118: WASM Migration Phase 1.
   *
   * @returns {boolean} True if WASM activation can be used.
   */
  private canUseWasm(): boolean {
    if (!isWasmActivationAvailable()) return false;
    return this.isWasmEligible();
  }

  /**
   * Issue #1256: Require WASM by default. Throws if WASM could not be loaded or creature is not WASM-eligible.
   * Callers do not initialise WASM; the library does so internally. Env vars are optional overrides for debug only.
   */
  private requireWasmOrThrow(): void {
    if (isUseJsActivationEnvSet()) return;
    if (!isWasmActivationAvailable()) {
      throw new Error(
        "WASM activation could not be loaded. Ensure the NEAT-AI package is installed correctly. " +
          "For verification-only mode, set NEAT_AI_USE_JS_ACTIVATION=1 (optional, debug only).",
      );
    }
    if (!this.isWasmEligible()) {
      const unsupported = this.getUnsupportedWasmSquashFunctions();
      throw new Error(
        "This creature uses squash functions not supported by the current backend: " +
          unsupported.join(", ") +
          ". For verification-only mode, set NEAT_AI_USE_JS_ACTIVATION=1 (optional, debug only).",
      );
    }
  }

  /**
   * Activate the creature using WASM. Backend is an implementation detail (Issue #1256).
   * Lazily compiles the creature to WASM on first call.
   *
   * @param {Float32Array} input - The input values for the creature.
   * @returns {Float32Array} The output values after activation.
   */
  private activateWasm(
    input: Float32Array,
    feedbackLoop: boolean,
  ): Float32Array {
    // Lazily compile to WASM if not already done
    if (!this.cachedWasmActivation) {
      const compiled = compileCreatureToWasm(this);
      this.cachedWasmActivation = WasmCreatureActivation.create(compiled) ??
        undefined;

      if (!this.cachedWasmActivation) {
        // At this point WASM was selected and eligibility was already checked.
        // Failing to instantiate the WASM network is unexpected; fail fast rather
        // than silently falling back to JS and masking the problem.
        fail(
          "WASM activation was selected but failed to instantiate CompiledNetwork",
        );
      }

      // Optimisation: for v4+ creatures explicitly marked forward-only, we can
      // skip resetting WASM activation state when feedbackLoop=false because
      // there are no recurrent/back edges that can read stale activations.
      const major = Number.parseInt(
        this.semanticVersion.split(".")[0] ?? "0",
        10,
      );
      const forwardOnlyGuaranteed = Number.isFinite(major) && major >= 4 &&
        this.forwardOnly === true;
      this.cachedWasmActivation.setNeedsResetWhenStateless(
        !forwardOnlyGuaranteed,
      );
    }

    // `activate()` should be fast and output-only.
    // Tracing/state backfill belongs in `activateAndTrace()`.
    return this.cachedWasmActivation.activateWithState(input, feedbackLoop);
  }

  /**
   * Activate the creature using WASM with tracing support for backpropagation.
   * Issue #1121: WASM Migration Phase 4 - activateAndTrace
   *
   * This method:
   * 1. Compiles the creature to WASM format (cached)
   * 2. Calls the WASM activate_and_trace method
   * 3. Applies the trace data to the creature's state (synapse usage flags)
   * 4. Sets hintValues for backpropagation
   *
   * @param {Float32Array} input - The input values for the creature.
   * @param {boolean} feedbackLoop - Whether to use a feedback loop during activation.
   * @param {SparseConfig} sparseConfig - The sparse configuration for tracing.
   * @returns {Float32Array} The output values after activation.
   */
  private activateAndTraceWasm(
    input: Float32Array,
    feedbackLoop: boolean,
    sparseConfig: SparseConfig,
  ): Float32Array {
    // Lazily compile to WASM if not already done
    if (!this.cachedWasmActivation) {
      const compiled = compileCreatureToWasm(this);
      this.cachedWasmActivation = WasmCreatureActivation.create(compiled) ??
        undefined;

      if (!this.cachedWasmActivation) {
        fail(
          "WASM activateAndTrace was selected but failed to instantiate CompiledNetwork",
        );
      }
    }

    // Prepare state for activation
    this.prepareNeurons();
    this.state.makeActivation(input, feedbackLoop);

    // Call WASM activateAndTrace
    const wasmResult = this.cachedWasmActivation.activateAndTraceWithFeedback(
      input,
      feedbackLoop,
    );

    // Apply activations to the state
    const neurons = this.neurons;
    for (let i = 0; i < wasmResult.activations.length; i++) {
      const neuronIdx = this.input + i;
      if (neuronIdx < neurons.length) {
        this.state.activations[neuronIdx] = wasmResult.activations[i];
      }
    }

    // Apply trace data to synapse states
    // The trace entries contain information about which synapses were "used"
    // for aggregate functions (MINIMUM, MAXIMUM, IF)
    this.applyWasmTraceData(wasmResult.traceEntries, sparseConfig);

    // Set hintValues for neurons that need propagation
    // hintValue is the pre-squash value (for standard squash functions)
    // or the activation (for aggregate functions)
    for (let i = this.input; i < neurons.length; i++) {
      const n = neurons[i];
      if (sparseConfig.propagateNeeded(n.uuid)) {
        this.state.node(n.index).hintValue =
          wasmResult.hintValues[i - this.input];
      }
    }

    return wasmResult.outputs;
  }

  /**
   * Apply WASM trace data to synapse states.
   * Issue #1121: WASM Migration Phase 4 - activateAndTrace
   *
   * This sets the `used` flag on synapse states for aggregate functions:
   * - For MINIMUM/MAXIMUM: only the winning synapse is marked as used
   * - For IF: condition synapses and active branch synapses are marked as used
   * - For standard squash: all synapses are implicitly used (no action needed)
   *
   * @param traceEntries - The trace entries from WASM activation
   * @param sparseConfig - The sparse configuration for tracing
   */
  private applyWasmTraceData(
    traceEntries: Array<{ neuronRelativeIndex: number; traceInfo: number }>,
    sparseConfig: SparseConfig,
  ): void {
    const neurons = this.neurons;

    for (const entry of traceEntries) {
      const neuronIdx = this.input + entry.neuronRelativeIndex;
      if (neuronIdx >= neurons.length) continue;

      const neuron = neurons[neuronIdx];
      if (!sparseConfig.traceNeeded(neuron.uuid)) continue;

      const inwardList = this.inwardConnections(neuronIdx);
      if (inwardList.length === 0) continue;

      // Sort by from index to match WASM ordering
      const sortedInward = inwardList.slice().sort((a, b) => a.from - b.from);

      const squash = neuron.squash ?? "IDENTITY";

      if (squash === "MINIMUM" || squash === "MAXIMUM") {
        // For MINIMUM/MAXIMUM: traceInfo is the local synapse index of the winning synapse
        const winningLocalIdx = Math.round(entry.traceInfo);

        // Mark all synapses as not used initially
        for (const c of sortedInward) {
          const cs = this.state.connection(c.from, c.to);
          if (cs.used === undefined) cs.used = false;
        }

        // Mark only the winning synapse as used
        if (winningLocalIdx >= 0 && winningLocalIdx < sortedInward.length) {
          const winningConnection = sortedInward[winningLocalIdx];
          this.state.connection(winningConnection.from, winningConnection.to)
            .used = true;
        }
      } else if (squash === "IF") {
        // For IF: traceInfo is 1.0 for positive branch, 0.0 for negative branch
        const positiveBranch = entry.traceInfo > 0.5;

        if (positiveBranch) {
          // Positive branch: mark positive/standard synapses as used
          for (const c of sortedInward) {
            const cs = this.state.connection(c.from, c.to);
            switch (c.type) {
              case "condition":
              case "negative":
                if (cs.used === undefined) cs.used = false;
                break;
              default:
                cs.used = true;
            }
          }
        } else {
          // Negative branch: mark negative synapses as used
          for (const c of sortedInward) {
            if (c.type === "negative") {
              this.state.connection(c.from, c.to).used = true;
            }
          }
        }
      }
    }

    // For non-aggregate neurons that need tracing, mark all synapses as used
    // (This matches the JS behaviour for standard squash functions)
    for (let i = this.input; i < neurons.length; i++) {
      const n = neurons[i];
      if (!sparseConfig.traceNeeded(n.uuid)) continue;

      const squash = n.squash ?? "IDENTITY";
      if (squash === "MINIMUM" || squash === "MAXIMUM" || squash === "IF") {
        // Already handled by trace entries
        continue;
      }

      // Standard squash: all synapses are used
      const inwardList = this.inwardConnections(i);
      for (const c of inwardList) {
        const cs = this.state.connection(c.from, c.to);
        cs.used = true;
      }
    }
  }

  /**
   * Check if this creature is eligible for WASM activation.
   * A creature is eligible if all its neurons use WASM-supported squash functions.
   * The result is cached and invalidated when structure changes.
   * Issue #1118: WASM Migration Phase 1.
   *
   * @returns {boolean} True if all squash functions are WASM-supported.
   */
  isWasmEligible(): boolean {
    // Return cached result if available
    if (this.wasmEligibilityCache !== undefined) {
      return this.wasmEligibilityCache;
    }

    // Check all non-input neurons for supported squash functions
    const unsupported = this.getUnsupportedWasmSquashFunctions();
    this.wasmEligibilityCache = unsupported.length === 0;

    return this.wasmEligibilityCache;
  }

  /**
   * Get the list of squash functions used by this creature that are not supported by WASM.
   * Issue #1118: WASM Migration Phase 1.
   *
   * @returns {string[]} Array of unsupported squash function names (empty if all are supported).
   */
  getUnsupportedWasmSquashFunctions(): string[] {
    const unsupported: string[] = [];
    const seen = new Set<string>();

    for (let i = this.input; i < this.neurons.length; i++) {
      const neuron = this.neurons[i];
      const squash = neuron.squash ?? "IDENTITY";

      // Skip if we've already checked this squash function
      if (seen.has(squash)) {
        continue;
      }
      seen.add(squash);

      // Check if squash function is in the WASM-supported list (or aliases to one)
      if (resolveWasmSquashName(squash) === undefined) {
        unsupported.push(squash);
      }
    }

    return unsupported;
  }

  /**
   * Dispose of cached WASM resources.
   * Call this when the creature structure changes or when done using WASM activation.
   * Issue #1118: WASM Migration Phase 1.
   */
  disposeWasm(): void {
    if (this.cachedWasmActivation) {
      this.cachedWasmActivation.free();
      this.cachedWasmActivation = undefined;
    }
    this.wasmEligibilityCache = undefined;
  }

  /**
   * Extracts output values from the activations array.
   *
   * @param {Float32Array} activations - The full activations array.
   * @param {number} lastHiddenNode - The index of the first output neuron.
   * @returns {Float32Array} The output values.
   */
  private extractOutputs(
    activations: Float32Array,
    lastHiddenNode: number,
  ): Float32Array {
    return new Float32Array(activations.subarray(lastHiddenNode));
  }

  /**
   * Compact the creature by removing redundant neurons and connections.
   *
   * @returns {Creature | undefined} A new compacted creature or undefined if no compaction occurred.
   */
  compact(feedbackLoop: boolean): Creature | undefined {
    return compactCreature(this, feedbackLoop);
  }

  /**
   * Validate the creature structure.
   */
  validate(options?: {
    neurons?: number;
    connections?: number;
    feedbackLoop?: boolean;
    forwardOnly?: boolean;
  }) {
    creatureValidate(this, options);
  }

  /**
   * Get a self-connection for the neuron at the given index.
   *
   * @param {number} indx - The index of the neuron.
   * @returns {SynapseInternal | null} The self-connection or null if not found.
   */
  selfConnection(indx: number): SynapseInternal | null {
    let results = this.cacheSelf.get(indx);
    if (results === undefined) {
      results = [];
      const tmpList = this.synapses;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];
        if (c.to === indx && c.from === indx) {
          results.push(c);
        }
      }

      this.cacheSelf.set(indx, results);
    }

    if (results.length > 0) {
      return results[0];
    } else {
      return null;
    }
  }

  /**
   * Get the inward connections (afferent) for the neuron at the given index.
   * Uses a secondary index sorted by `to` field for O(log n) binary search lookup.
   * Issue #1010: Performance optimisation for large creatures.
   *
   * @param {number} toIndx - The index of the target neuron.
   * @returns {Synapse[]} The list of inward connections.
   */
  inwardConnections(toIndx: number): Synapse[] {
    let results = this.cacheTo.get(toIndx);
    if (results === undefined) {
      results = this.lookupInwardConnections(toIndx);
      this.cacheTo.set(toIndx, results);
    }
    return results;
  }

  /**
   * Builds the secondary index of synapses sorted by `to` field.
   * Called lazily when first needed for inward connection lookups.
   * Issue #1010: Performance optimisation for large creatures.
   */
  private buildSynapsesIndexedByTo(): Synapse[] {
    // Create a copy of synapses sorted by 'to' field, then by 'from' for stability
    const indexed = this.synapses.slice().sort((a, b) => {
      if (a.to !== b.to) return a.to - b.to;
      return a.from - b.from;
    });
    return indexed;
  }

  /**
   * Binary search for the start index in the secondary (to-sorted) index.
   * Issue #1010: Performance optimisation for large creatures.
   */
  private binarySearchForToStartIndex(
    index: Synapse[],
    toIndx: number,
  ): number {
    let low = 0;
    let high = index.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = index[mid];

      if (midValue.to < toIndx) {
        low = mid + 1;
      } else if (midValue.to > toIndx) {
        high = mid - 1;
      } else {
        result = mid; // Found a matching 'to', but need the first occurrence
        high = mid - 1; // Look left to find the first match
      }
    }

    return result;
  }

  /**
   * Threshold for switching from linear scan to building the secondary index.
   * If we've done this many cache misses, it's worth building the sorted index.
   * Issue #1010: Performance optimisation for large creatures.
   */
  private inwardCacheMissCount = 0;
  private static readonly INWARD_INDEX_BUILD_THRESHOLD = 3;

  /**
   * Minimum number of synapses to trigger proactive index prebuilding.
   * Only prebuild for large creatures where the upfront cost is worthwhile.
   * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
   */
  public static readonly PREBUILD_SYNAPSE_THRESHOLD = 1000;

  /**
   * Looks up inward connections using binary search on the secondary index.
   * Falls back to linear scan if index is not built.
   * Automatically builds the index after a few cache misses.
   * Issue #1010: Performance optimisation for large creatures.
   */
  private lookupInwardConnections(toIndx: number): Synapse[] {
    // If we have the secondary index, use binary search
    if (this.synapsesIndexedByTo !== null) {
      const index = this.synapsesIndexedByTo;
      const startIndex = this.binarySearchForToStartIndex(index, toIndx);

      if (startIndex === -1) {
        return []; // No inward connections found
      }

      // Collect all synapses with matching 'to' index
      const results: Synapse[] = [];
      for (let i = startIndex; i < index.length; i++) {
        const synapse = index[i];
        if (synapse.to === toIndx) {
          results.push(synapse);
        } else {
          break; // Since it's sorted, no need to continue once 'to' changes
        }
      }

      return results;
    }

    // Track cache misses - if we're doing many lookups, build the index
    this.inwardCacheMissCount++;
    if (this.inwardCacheMissCount >= Creature.INWARD_INDEX_BUILD_THRESHOLD) {
      // Build the index and use binary search for this and future lookups
      this.synapsesIndexedByTo = this.buildSynapsesIndexedByTo();
      return this.lookupInwardConnections(toIndx); // Recurse with index now built
    }

    // Fallback: linear scan for sparse lookups (O(n) but no sorting overhead)
    const results: Synapse[] = [];
    for (let i = 0, len = this.synapses.length; i < len; i++) {
      const synapse = this.synapses[i];
      if (synapse.to === toIndx) {
        results.push(synapse);
      }
    }
    return results;
  }

  /**
   * Pre-builds the secondary index for inward connections.
   * Call this after loading a creature or after a batch of mutations
   * to optimise subsequent lookups.
   * Issue #1010: Performance optimisation for large creatures.
   */
  public prebuildInwardIndex(): void {
    if (this.synapsesIndexedByTo === null) {
      this.synapsesIndexedByTo = this.buildSynapsesIndexedByTo();
    }
  }

  /**
   * Checks if the inward synapse index has been built.
   * This is primarily used for testing the prebuild optimisation.
   * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
   *
   * @returns {boolean} True if the index has been built, false otherwise.
   */
  public isInwardIndexBuilt(): boolean {
    return this.synapsesIndexedByTo !== null;
  }

  /**
   * Conditionally prebuilds the inward index for large creatures.
   * Only prebuilds if the creature has many synapses (>= PREBUILD_SYNAPSE_THRESHOLD).
   * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
   */
  public prebuildInwardIndexIfLarge(): void {
    if (this.synapses.length >= Creature.PREBUILD_SYNAPSE_THRESHOLD) {
      this.prebuildInwardIndex();
    }
  }

  /**
   * Bulk loads all inward connections into the cache.
   * Use this when you know you'll need to look up many neurons.
   * Issue #1010: Performance optimisation for large creatures.
   */
  public bulkLoadInwardConnections(): void {
    // Build secondary index if not already built
    if (this.synapsesIndexedByTo === null) {
      this.synapsesIndexedByTo = this.buildSynapsesIndexedByTo();
    }

    // Pre-populate cache for all neurons
    const cacheTo = this.cacheTo;
    for (let indx = 0, len = this.neurons.length; indx < len; indx++) {
      if (!cacheTo.has(indx)) {
        cacheTo.set(indx, []);
      }
    }

    // Group synapses by their 'to' index using the sorted index
    const index = this.synapsesIndexedByTo;
    for (let i = 0, len = index.length; i < len; i++) {
      const synapse = index[i];
      const to = synapse.to;
      const tmpResults = cacheTo.get(to);
      if (tmpResults) {
        tmpResults.push(synapse);
      }
    }
  }

  /**
   * Builds and returns a Set of existing connections as "from-to" strings.
   * Enables O(1) lookup for connection existence checks.
   * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
   *
   * @returns {Set<string>} Set of connection keys in "from-to" format
   */
  public getConnectionSet(): Set<string> {
    if (this.connectionSet === null) {
      this.connectionSet = new Set<string>();
      for (let i = 0, len = this.synapses.length; i < len; i++) {
        const synapse = this.synapses[i];
        this.connectionSet.add(`${synapse.from}-${synapse.to}`);
      }
    }
    return this.connectionSet;
  }

  /**
   * Checks if a connection exists between two neurons in O(1) time.
   * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   * @returns {boolean} True if the connection exists, false otherwise.
   */
  public hasConnection(from: number, to: number): boolean {
    return this.getConnectionSet().has(`${from}-${to}`);
  }

  /**
   * Builds and returns a cached Set of hidden neuron UUIDs.
   * Enables O(1) lookup for genetic compatibility checks.
   * Issue #1032: Performance optimisation for genetic compatibility checks.
   *
   * @returns {Set<string>} Set of hidden neuron UUIDs
   */
  public getHiddenNeuronUUIDs(): Set<string> {
    if (this.hiddenNeuronUUIDs === null) {
      this.hiddenNeuronUUIDs = new Set<string>();
      for (let i = this.input, len = this.neurons.length; i < len; i++) {
        const neuron = this.neurons[i];
        if (neuron.type === "hidden") {
          this.hiddenNeuronUUIDs.add(neuron.uuid);
        }
      }
    }
    return this.hiddenNeuronUUIDs;
  }

  /**
   * Returns a list of available forward-only connection slots (from, to pairs).
   * This method efficiently finds all valid connection pairs where:
   * - from < to (forward-only)
   * - to >= input (cannot connect to input neurons)
   * - target neuron is not a constant
   * - connection doesn't already exist
   *
   * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
   * Issue #1098: Results are cached and invalidated on structure changes.
   *
   * @param {number[]} [focusList] - Optional list of neuron indices to focus on.
   *   When provided, returns only connections involving focused neurons or their paths.
   * @returns {[number, number][]} Array of [from, to] tuples representing available connections.
   */
  public getAvailableConnections(focusList?: number[]): [number, number][] {
    // Build and cache all available connections if not already cached
    if (this.availableConnectionsCache === null) {
      this.availableConnectionsCache = this.computeAvailableConnections();
    }

    // If no focus list provided, return the cached array directly
    if (!focusList || focusList.length === 0) {
      return this.availableConnectionsCache;
    }

    // Filter cached connections based on focus list
    return this.availableConnectionsCache.filter(([from, to]) => {
      return this.inFocus(from, focusList) || this.inFocus(to, focusList);
    });
  }

  /**
   * Computes all available forward-only connection slots.
   * This is called internally to build the cache.
   * Issue #1098: Extracted to support caching.
   *
   * @returns {[number, number][]} Array of [from, to] tuples.
   */
  private computeAvailableConnections(): [number, number][] {
    const connectionSet = this.getConnectionSet();
    const available: [number, number][] = [];
    const neurons = this.neurons;
    const neuronCount = neurons.length;
    const inputCount = this.input;

    for (let fromIndx = 0; fromIndx < neuronCount; fromIndx++) {
      // Start toIndx at max(fromIndx + 1, input) to ensure forward-only connections
      // and that we don't connect to input neurons
      const startTo = Math.max(fromIndx + 1, inputCount);

      for (let toIndx = startTo; toIndx < neuronCount; toIndx++) {
        const neuronTo = neurons[toIndx];

        // Skip constant neurons
        if (neuronTo.type === "constant") continue;

        // Check if connection already exists using O(1) Set lookup
        const key = `${fromIndx}-${toIndx}`;
        if (!connectionSet.has(key)) {
          available.push([fromIndx, toIndx]);
        }
      }
    }

    return available;
  }

  /**
   * Checks if the available connections cache has been built.
   * This is primarily used for testing the cache optimisation.
   * Issue #1098: Performance - Cache available connection pairs.
   *
   * @returns {boolean} True if the cache has been built, false otherwise.
   */
  public isAvailableConnectionsCacheBuilt(): boolean {
    return this.availableConnectionsCache !== null;
  }

  /**
   * Get the outward connections (efferent) for the neuron at the given index.
   *
   * @param {number} fromIndx - The index of the source neuron.
   * @returns {Synapse[]} The list of outward connections.
   */
  outwardConnections(fromIndx: number): Synapse[] {
    let results = this.cacheFrom.get(fromIndx);
    if (results === undefined) {
      const startIndex = this.binarySearchForStartIndex(fromIndx);

      if (startIndex !== -1) {
        results = [];
        for (let i = startIndex; i < this.synapses.length; i++) {
          const tmp = this.synapses[i];
          if (tmp.from === fromIndx) {
            results.push(tmp);
          } else {
            break; // Since it's sorted, no need to continue once 'from' changes
          }
        }
      } else {
        results = []; // No connections found
      }

      this.cacheFrom.set(fromIndx, results);
    }
    return results;
  }

  private binarySearchForStartIndex(fromIndx: number): number {
    let low = 0;
    let high = this.synapses.length - 1;
    let result = -1; // Default to -1 if not found

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = this.synapses[mid];

      if (midValue.from < fromIndx) {
        low = mid + 1;
      } else if (midValue.from > fromIndx) {
        high = mid - 1;
      } else {
        result = mid; // Found a matching 'from', but need the first occurrence
        high = mid - 1; // Look left to find the first match
      }
    }

    return result;
  }

  /**
   * Get a specific synapse between two neurons.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   * @returns {Synapse | null} The synapse or null if not found.
   */
  getSynapse(from: number, to: number): Synapse | null {
    const outwardConnections = this.outwardConnections(from);

    for (let indx = outwardConnections.length; indx--;) {
      const c = outwardConnections[indx];
      if (c.to === to) {
        return c;
      } else if (c.to < to) {
        break;
      }
    }

    return null;
  }

  /**
   * Connect two neurons with a synapse.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   * @param {number} weight - The weight of the synapse.
   * @param {string} [type] - The type of the synapse.
   * @returns {Synapse} The created synapse.
   */
  connect(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ): Synapse {
    const connection = new Synapse(
      from,
      to,
      weight,
      type,
    );

    let location = -1;

    for (let indx = this.synapses.length; indx--;) {
      const c = this.synapses[indx];

      if (c.from < from) {
        location = indx + 1;
        break;
      } else if (c.from === from) {
        assert(c.to !== to, "Connection already exists");

        if (c.to < to) {
          location = indx + 1;
          break;
        } else {
          location = indx;
        }
      } else {
        location = indx;
      }
    }
    if (location !== -1 && location < this.synapses.length) {
      // Use splice() for in-place insertion - Issue #1093
      // This reduces memory allocations from 3 to 0 compared to slice/spread
      this.synapses.splice(location, 0, connection);
    } else {
      this.synapses.push(connection);
    }

    this.clearCache(from, to);
    this.invalidateScoreCache();

    return connection;
  }

  /**
   * Disconnect two neurons by removing the synapse between them.
   * Uses binary search for O(log n) lookup since synapses are sorted by (from, to).
   * Issue #1101: Performance optimisation for large creatures.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   */
  disconnect(from: number, to: number) {
    const indx = this.binarySearchSynapse(from, to);
    if (indx !== -1) {
      this.synapses.splice(indx, 1);
      this.clearCache(from, to);
      this.invalidateScoreCache();
    }
  }

  /**
   * Batch connect multiple synapses with a single cache invalidation.
   * Issue #1102: Performance optimisation for operations that add multiple synapses.
   *
   * This method is significantly more efficient than calling connect() in a loop
   * because it:
   * 1. Sorts connections first to enable efficient insertion
   * 2. Validates all connections before inserting any
   * 3. Invalidates caches only once at the end
   *
   * @param connections Array of connection specifications
   * @throws {Error} If any connection already exists or duplicates exist within batch
   */
  connectBatch(
    connections: Array<{
      from: number;
      to: number;
      weight: number;
      type?: "positive" | "negative" | "condition";
    }>,
  ): void {
    if (connections.length === 0) {
      return;
    }

    // Check for duplicates within the batch using a Set
    const batchSet = new Set<string>();
    for (const conn of connections) {
      const key = `${conn.from}-${conn.to}`;
      if (batchSet.has(key)) {
        throw new Error(`Duplicate connection in batch: ${key} already exists`);
      }
      batchSet.add(key);
    }

    // Check that none of the connections already exist
    for (const conn of connections) {
      const existing = this.binarySearchSynapse(conn.from, conn.to);
      if (existing !== -1) {
        throw new Error(
          `Connection ${conn.from}->${conn.to} already exists in creature`,
        );
      }
    }

    // Sort connections by (from, to) for efficient insertion
    const sortedConnections = [...connections].sort((a, b) => {
      if (a.from !== b.from) {
        return a.from - b.from;
      }
      return a.to - b.to;
    });

    // Insert all synapses
    // We process in reverse order of sorted array when inserting to maintain
    // correct positions as the array grows
    for (const conn of sortedConnections) {
      const synapse = new Synapse(conn.from, conn.to, conn.weight, conn.type);
      const location = this.findInsertionPoint(conn.from, conn.to);
      if (location < this.synapses.length) {
        this.synapses.splice(location, 0, synapse);
      } else {
        this.synapses.push(synapse);
      }
    }

    // Single cache invalidation at the end
    this.clearCache();
    this.invalidateScoreCache();
  }

  /**
   * Find the insertion point for a synapse to maintain sorted order.
   * Uses binary search for O(log n) efficiency.
   * Issue #1102: Helper method for connectBatch.
   *
   * @param from - The source neuron index.
   * @param to - The target neuron index.
   * @returns The index where the synapse should be inserted.
   */
  private findInsertionPoint(from: number, to: number): number {
    const synapses = this.synapses;
    let low = 0;
    let high = synapses.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const syn = synapses[mid];

      if (syn.from < from || (syn.from === from && syn.to < to)) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * Batch disconnect multiple synapses with a single cache invalidation.
   * Issue #1102: Performance optimisation for operations that remove multiple synapses.
   *
   * This method is significantly more efficient than calling disconnect() in a loop
   * because it:
   * 1. Finds all synapse indices first
   * 2. Removes them in descending order to maintain correct indices
   * 3. Invalidates caches only once at the end
   *
   * Non-existent connections are silently ignored.
   *
   * @param pairs Array of (from, to) pairs to disconnect
   */
  disconnectBatch(pairs: Array<{ from: number; to: number }>): void {
    if (pairs.length === 0) {
      return;
    }

    // Find all indices to remove
    const indices: number[] = [];
    for (const pair of pairs) {
      const idx = this.binarySearchSynapse(pair.from, pair.to);
      if (idx !== -1) {
        indices.push(idx);
      }
    }

    if (indices.length === 0) {
      return;
    }

    // Sort indices in descending order so we can remove from end to start
    // without affecting the positions of earlier indices
    indices.sort((a, b) => b - a);

    // Remove each synapse
    for (const idx of indices) {
      this.synapses.splice(idx, 1);
    }

    // Single cache invalidation at the end
    this.clearCache();
    this.invalidateScoreCache();
  }

  /**
   * Binary search for a synapse by (from, to) indices.
   * Synapses are sorted first by `from`, then by `to` within the same `from`.
   * Issue #1101: Performance optimisation for disconnect operations.
   *
   * @param {number} from - The source neuron index.
   * @param {number} to - The target neuron index.
   * @returns {number} The index of the synapse, or -1 if not found.
   */
  private binarySearchSynapse(from: number, to: number): number {
    const synapses = this.synapses;
    let low = 0;
    let high = synapses.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const syn = synapses[mid];

      if (syn.from < from) {
        low = mid + 1;
      } else if (syn.from > from) {
        high = mid - 1;
      } else {
        // syn.from === from, now compare `to`
        if (syn.to < to) {
          low = mid + 1;
        } else if (syn.to > to) {
          high = mid - 1;
        } else {
          return mid; // Found exact match
        }
      }
    }

    return -1; // Not found
  }

  /**
   * Apply learnings to the creature using back propagation.
   *
   * @param {BackPropagationConfig} config - The back propagation configuration.
   * @returns {boolean} True if the creature was changed, false otherwise.
   */
  applyLearnings(
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): boolean {
    this.propagateUpdate(config, sparseConfig);

    let changed = false;
    for (let indx = this.neurons.length - 1; indx >= this.input; indx--) {
      if (config.trainingMutationRate > Math.random()) {
        const n = this.neurons[indx];
        if (sparseConfig.updateNeeded(n.uuid)) {
          changed ||= n.applyLearnings();
        }
      }
    }

    if (changed) {
      delete this.uuid;
      delete this.memetic;
      this.state.preparedNeurons = false;
      this.fix();
    }

    return changed;
  }

  /**
   * Propagate the expected values through the creature's network.
   *
   * @param {Float32Array} expected - The expected output values.
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagate(
    expected: Float32Array,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ) {
    this.state.cacheAdjustedActivation.clear();

    const neurons = this.neurons;
    const lastOutputIndx = neurons.length - this.output;

    for (let indx = this.output; indx--;) {
      const nodeIndex = lastOutputIndx + indx;

      const n = neurons[nodeIndex];

      if (sparseConfig.propagateNeeded(n.uuid)) {
        n.propagate(
          expected[indx],
          config,
          sparseConfig,
        );
      }
    }
  }

  /**
   * Record the expected values for back propagation.
   *
   * @param {Float32Array} expected - The expected output values.
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  record(
    expected: Float32Array,
  ): Map<string, DiscoverRecord> {
    const neurons = this.neurons;
    const lastOutputIndx = neurons.length - this.output;

    const errorMap = new Map<string, DiscoverRecord>();
    for (let indx = this.output; indx--;) {
      const nodeIndex = lastOutputIndx + indx;

      const n = neurons[nodeIndex];

      n.record(
        expected[indx],
        errorMap,
      );
    }

    // DIAGNOSTIC: Check for excessive total error count per sample
    let totalErrors = 0;
    for (const record of errorMap.values()) {
      totalErrors += record.errors.length;
    }

    // Expected: approximately neurons.length * output (one error per neuron per output)
    const expectedMax = neurons.length * this.output * 3;
    if (totalErrors > expectedMax) {
      console.error(
        `❌ CRITICAL: Sample generated ${totalErrors} total errors (expected ≤${expectedMax})`,
      );
      console.error(
        `   Neurons: ${neurons.length}, Outputs: ${this.output}, ErrorMap size: ${errorMap.size}`,
      );
      // Log top 5 neurons with most errors
      const sorted = Array.from(errorMap.entries())
        .sort((a, b) => b[1].errors.length - a[1].errors.length)
        .slice(0, 5);
      console.error(`   Top 5 neurons by error count:`);
      sorted.forEach(([uuid, rec]) => {
        console.error(`     - ${uuid}: ${rec.errors.length} errors`);
      });

      if (totalErrors > expectedMax * 10) {
        throw new Error(
          `Excessive errors detected: ${totalErrors} total errors in single sample ` +
            `(expected ≤${expectedMax}). This indicates record() is being called too many times, ` +
            `causing the performance issue and timeout.`,
        );
      }
    }

    return errorMap;
  }

  /**
   * Update the propagated values in the creature's network.
   *
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagateUpdate(config: BackPropagationConfig, sparseConfig: SparseConfig) {
    let didUpdate = false;
    for (let indx = this.input; indx < this.neurons.length; indx++) {
      const n = this.neurons[indx];
      if (sparseConfig.updateNeeded(n.uuid)) {
        n.propagateUpdate(config);
        didUpdate = true;
      }
    }
    this.state.preparedNeurons = false;

    // If weights/biases changed, any cached WASM compilation is now stale.
    // Free it so the next activation recompiles with updated parameters.
    if (didUpdate && this.cachedWasmActivation) {
      this.cachedWasmActivation.free();
      this.cachedWasmActivation = undefined;
    }
  }

  /**
   * Evolve the creature to achieve a lower error on a dataset.
   *
   * @param {string} dataSetDir - The directory containing the dataset.
   * @param {NeatOptions} options - The NEAT configuration options.
   * @returns {Promise<{ error: number; score: number; time: number }>} The evolution result.
   */
  async evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ): Promise<
    { error: number; score: number; time: number; generation: number }
  > {
    let interrupted = false;
    const signalListener = () => {
      console.log("SIGTERM received, saving progress...");
      interrupted = true;
    };

    Deno.addSignalListener("SIGTERM", signalListener);

    const start = Date.now();
    const config = createNeatConfig(options);

    const endTimeMS = config.timeoutMinutes
      ? start + Math.max(1, config.timeoutMinutes) * 60000
      : 0;

    const workers: WorkerHandler[] = [];

    const threads = config.threads;

    for (let i = threads; i--;) {
      workers.push(
        new WorkerHandler(
          dataSetDir,
          config.costName,
          threads === 1,
          config.customCost,
        ),
      );
    }

    // Initialize the NEAT instance
    const neat = new Neat(
      this.input,
      this.output,
      config,
      workers,
    );

    // Issue #997: Pass the data directory to enable discovery replay
    neat.setDataDir(dataSetDir);

    neat.populatePopulation(this);

    let error = Infinity;
    let bestScore = -Infinity;
    let bestCreature: Creature | undefined;

    let iterationStartMS = Date.now();
    let generation = 0;
    const targetError = config.targetError;
    const iterations = config.iterations;

    while (true) {
      // deno-lint-ignore no-await-in-loop
      const result = await neat.evolve(
        bestCreature,
      );

      const fittest: Creature = result.fittest;
      const fittestScore = fittest.score!;
      assert(fittestScore >= bestScore, "Score is less than best score");
      if (fittestScore > bestScore) {
        const errorTmp = getTag(fittest, "error");
        assert(errorTmp, "No error tag found");

        error = Number.parseFloat(errorTmp);
        assert(Number.isFinite(error), "Error is not finite");
        assert(error >= 0, "Error is negative");
        assert(
          fittestScore - 1 <= error * -1,
          `Score (absolute) less than error (score=${fittestScore}, error=${error})`,
        );
        bestScore = fittestScore;
        bestCreature = Creature.fromJSON(fittest.exportJSON());
        bestCreature.uuid = fittest.uuid;
        bestCreature.score = bestScore;
      }

      const now = Date.now();
      const timedOut = endTimeMS ? now > endTimeMS : false;

      generation++;

      const completed = interrupted || timedOut || error <= targetError ||
        generation >= iterations;

      if (
        config.log &&
        (generation % config.log === 0 || completed)
      ) {
        let avgTxt = "";
        if (Number.isFinite(result.averageScore)) {
          avgTxt = `(avg: ${yellow(result.averageScore.toFixed(4))})`;
        }
        console.log(
          "Generation",
          generation,
          "score",
          fittest.score,
          avgTxt,
          "error",
          error,
          (config.log > 1 ? "avg " : "") + "time",
          yellow(
            format(Math.round((now - iterationStartMS) / config.log), {
              ignoreZero: true,
            }),
          ),
        );

        iterationStartMS = now;
      }

      if (completed) {
        if (interrupted) break;
        if (neat.finishUp(iterations, endTimeMS, start, generation)) {
          break;
        }
      }

      // Checkpoint: Save creatures after each generation if enabled.
      // No need on the final generation as that will be done by the normal process.
      if (
        config.checkpointEveryGeneration && config.creatureStore
      ) {
        this.writeCreatures(neat, config.creatureStore);
      }
    }

    for (let i = workers.length; i--;) {
      const w = workers[i];
      w.terminate();
    }
    workers.length = 0; // Release the memory.

    if (bestCreature) {
      this.loadFrom(bestCreature, config.debug);
    }

    if (config.creatureStore) {
      this.writeCreatures(neat, config.creatureStore);
    }

    Deno.removeSignalListener("SIGTERM", signalListener);
    return {
      error: error,
      score: bestScore,
      generation: generation,
      time: Date.now() - start,
    };
  }

  /**
   * Evolve the creature to achieve a lower error on a dataset.
   *
   * @param {DataRecordInterface[]} dataSet - The dataset for evolution.
   * @param {NeatOptions} options - The NEAT configuration options.
   * @returns {Promise<{ error: number; score: number; time: number }>} The evolution result.
   */
  async evolveDataSet(
    dataSet: DataRecordInterface[],
    options: NeatOptions,
  ): Promise<{ error: number; score: number; time: number }> {
    const config = createNeatConfig(options);

    const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak, {
      input: this.input,
      output: this.output,
    });

    const result = await this.evolveDir(dataSetDir, config);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  /**
   * Score the creature using a dataset.
   *
   * @param dataDir The directory containing the dataset.
   * @param options The NEAT configuration options.
   * @returns the score and error of the creature.
   */
  async scoreDir(
    dataDir: string,
    options: NeatOptions,
  ): Promise<{ score: number; error: number }> {
    const config = createNeatConfig(options);

    const result = await this.evaluateDir(
      dataDir,
      Costs.find(config.costName),
      config.feedbackLoop,
    );

    this.score = calculateScore(
      this,
      result.error,
      config.costOfGrowth,
    );
    return { error: result.error, score: this.score };
  }

  /**
   * Run the discovery process for this creature using a dataset directory.
   *
   * @param dataDir Directory containing the dataset subset used for discovery.
   * @param options NEAT configuration options controlling discovery behaviour.
   * @param deps Optional overrides, primarily for testing.
   */
  async discoveryDir(
    dataDir: string,
    options: NeatOptions,
    deps?: { runner?: DiscoveryRunnerLike },
  ): Promise<DiscoveryDirResult> {
    const runner = deps?.runner ?? new DiscoveryRunner();

    return await runner.discoverDir({
      creature: this,
      dataDir,
      options,
    });
  }

  /**
   * Replay cached discovery successes against this creature using a dataset directory.
   *
   * This is designed for long-running workflows where discovery results may be
   * overtaken by normal evolution before they are reintroduced into the
   * population. Replay lets you re-apply previously successful candidates to the
   * current fittest creature and prune stale cache entries when they no longer
   * improve score.
   *
   * @param dataDir Directory containing the dataset subset used for replay scoring.
   * @param options NEAT configuration options controlling replay behaviour.
   * @param deps Optional overrides, primarily for testing.
   */
  async discoveryReplayDir(
    dataDir: string,
    options: NeatOptions,
    deps?: { runner?: DiscoveryReplayRunnerLike },
  ): Promise<DiscoveryReplayDirResult> {
    const runner = deps?.runner ?? new DiscoveryReplayRunner();

    return await runner.replayDir({
      creature: this,
      dataDir,
      options,
    });
  }

  /**
   * Trace the creature using a dataset.
   *
   * @param dataDir The directory containing the dataset.
   * @param options The NEAT configuration options.
   * @returns the score and error of the creature.
   */
  traceDir(
    dataDir: string,
    options: NeatOptions,
  ): { score: number; error: number } {
    const dataResult = dataFiles(dataDir);
    assert(dataResult.files.length > 0, "No data files found");
    const config = createNeatConfig(options);
    const cost = Costs.find(config.costName);
    let error = 0;
    let count = 0;
    const backPropConfig = createBackPropagationConfig(config);
    const sparseConfig = new SparseConfig(
      this.exportJSON(),
      backPropConfig,
    );

    const valuesCount = this.input + this.output;
    const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
    // Issue #1195: Increased from 128KB to 512KB for NVMe drives
    const NVME_OPTIMAL_READ_SIZE = 512 * 1024; // 512 KB
    const BATCH_SIZE = Math.max(
      1,
      Math.floor(NVME_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
    );
    const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

    // Shared buffers for batch processing
    const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
    const batchArray = new Float32Array(batchBuffer.buffer);

    for (let fileIndx = dataResult.files.length; fileIndx--;) {
      const filePath = dataResult.files[fileIndx];
      const file = Deno.openSync(filePath, { read: true });

      try {
        while (true) {
          // Read a batch of records
          const bytesRead = file.readSync(batchBuffer);
          if (bytesRead === null) {
            break;
          }
          assert(bytesRead > 0, "Invalid number of bytes read");

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
          assert(
            bytesRead % BYTES_PER_RECORD === 0,
            "Invalid number of bytes read",
          );

          // Process each record in the batch
          for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
            const offset = recordIndex * valuesCount;
            const inputEnd = offset + this.input;
            const observations = new Float32Array(batchArray.subarray(
              offset,
              inputEnd,
            ));

            const actuals = this.activateAndTrace(
              observations,
              true,
              sparseConfig,
            );

            const targets = new Float32Array(batchArray.subarray(
              inputEnd,
              offset + valuesCount,
            ));
            this.propagate(targets, backPropConfig, sparseConfig);

            error += cost.calculate(targets, actuals);
            count++;
          }
        }
      } finally {
        file.close();
      }
    }
    let averageError = 0;
    if (count > 0) {
      averageError = error / count;
    }
    this.score = calculateScore(
      this,
      averageError,
      config.costOfGrowth,
    );

    return { error: averageError, score: this.score };
  }

  /**
   * Evaluate a dataset and return the error.
   *
   * @param {string} dataDir - The directory containing the dataset.
   * @param {CostInterface} cost - The cost function to evaluate the error.
   * @param {boolean} feedbackLoop - Whether to use a feedback loop during evaluation.
   * @returns {{ error: number }} The evaluation result.
   */
  async evaluateDir(
    dataDir: string,
    cost: CostInterface,
    feedbackLoop: boolean,
  ): Promise<{ error: number }> {
    const dataResult = dataFiles(dataDir);
    assert(dataResult.files.length > 0, "No data files found");

    // Issue #1247: Auto-initialise WASM before scoring if not yet available.
    if (!isUseJsActivationEnvSet()) {
      await ensureWasmActivation();
    }

    // Issue #1229: WASM is required by default with no fallback.
    this.requireWasmOrThrow();

    let error = 0;
    let count = 0;

    // Determine whether we can use the WASM scoring fast paths.
    const canUseWasm = this.canUseWasm();
    const costName = cost.getName();
    const major = Number.parseInt(
      this.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    const forwardOnlyGuaranteed = Number.isFinite(major) && major >= 4 &&
      this.forwardOnly === true;

    // Issue #1193: For forward-only creatures, feedbackLoop has no effect since there
    // are no recurrent connections. Normalize to false for consistency and performance.
    const effectiveFeedbackLoop = forwardOnlyGuaranteed ? false : feedbackLoop;

    // Ensure WASM network is compiled once for scoring.
    if (canUseWasm && !this.cachedWasmActivation) {
      const compiled = compileCreatureToWasm(this);
      this.cachedWasmActivation = WasmCreatureActivation.create(compiled) ??
        undefined;
      if (!this.cachedWasmActivation) {
        fail(
          "WASM activation was selected but failed to instantiate CompiledNetwork",
        );
      }
      this.cachedWasmActivation.setNeedsResetWhenStateless(
        !forwardOnlyGuaranteed,
      );
    }

    // Pre-allocate a reusable output buffer for non-fused scoring.
    const outputBuffer = canUseWasm ? new Float32Array(this.output) : null;

    const valuesCount = this.input + this.output;
    const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
    // Issue #1195: Increased from 128KB to 512KB for NVMe drives
    const NVME_OPTIMAL_READ_SIZE = 512 * 1024; // 512 KB
    const BATCH_SIZE = Math.max(
      1,
      Math.floor(NVME_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
    );
    const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

    // Shared buffers for batch processing
    const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
    const batchArray = new Float32Array(batchBuffer.buffer);

    // Fused WASM scoring is only valid for stateless scoring with supported cost functions.
    // All built-in cost functions are supported: MSE, MAE, CROSS_ENTROPY, MAPE, MSLE, HINGE.
    const supportedFusedCosts = [
      "MSE",
      "MAE",
      "CROSS_ENTROPY",
      "MAPE",
      "MSLE",
      "HINGE",
    ] as const;
    // Issue #1193: For forward-only creatures, feedbackLoop has no effect since there are
    // no recurrent connections to preserve state. We can use the fused path regardless.
    const useFusedWasm = canUseWasm && forwardOnlyGuaranteed &&
      supportedFusedCosts.includes(
        costName as typeof supportedFusedCosts[number],
      );

    for (let fileIndx = dataResult.files.length; fileIndx--;) {
      const filePath = dataResult.files[fileIndx];
      const file = Deno.openSync(filePath, { read: true });

      try {
        while (true) {
          // Read a batch of records
          const bytesRead = file.readSync(batchBuffer);
          if (bytesRead === null) {
            break;
          }
          assert(bytesRead > 0, "Invalid number of bytes read");

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
          assert(
            bytesRead % BYTES_PER_RECORD === 0,
            "Invalid number of bytes read",
          );

          if (useFusedWasm) {
            // Process the whole batch in a single WASM call:
            // records are laid out as [inputs..., targets...] per record.
            const floatsRead = recordsRead * valuesCount;
            const slice = batchArray.subarray(0, floatsRead);
            const wasm = this.cachedWasmActivation!;

            switch (costName) {
              case "MSE":
                error += wasm.mseSumBatchPacked(slice, this.input, true);
                break;
              case "MAE":
                error += wasm.maeSumBatchPacked(slice, this.input, true);
                break;
              case "CROSS_ENTROPY":
                error += wasm.crossEntropySumBatchPacked(
                  slice,
                  this.input,
                  true,
                );
                break;
              case "MAPE":
                error += wasm.mapeSumBatchPacked(slice, this.input, true);
                break;
              case "MSLE":
                error += wasm.msleSumBatchPacked(slice, this.input, true);
                break;
              case "HINGE":
                error += wasm.hingeSumBatchPacked(slice, this.input, true);
                break;
            }
            count += recordsRead;
            continue;
          }

          // Process each record in the batch
          for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
            const offset = recordIndex * valuesCount;
            const inputEnd = offset + this.input;
            const observations = batchArray.subarray(offset, inputEnd);
            const target = batchArray.subarray(inputEnd, offset + valuesCount);

            if (canUseWasm) {
              // Zero-allocation activation during scoring.
              this.cachedWasmActivation!.activateIntoWithFeedback(
                observations,
                outputBuffer!,
                effectiveFeedbackLoop,
              );
              error += cost.calculate(target, outputBuffer!);
            } else {
              // NEAT_AI_USE_JS_ACTIVATION=1 or creature has unsupported squash.
              const actual = this.activate(
                observations,
                effectiveFeedbackLoop,
                true,
              );
              error += cost.calculate(target, actual);
            }

            count++;
          }
        }
      } finally {
        file.close();
      }
    }
    if (count === 0) {
      return { error: 0 };
    } else {
      const averageError = error / count;
      if (Number.isFinite(averageError)) {
        return { error: averageError };
      } else {
        console.warn(
          `AverageError: ${averageError} is not finite, Error: ${error}, Count: ${count}`,
        );
        return { error: Number.MAX_SAFE_INTEGER };
      }
    }
  }

  private writeCreatures(neat: Neat, dir: string) {
    let counter = 1;
    emptyDirSync(dir);
    neat.population.forEach((creature) => {
      const json = creature.exportJSON();

      const txt = JSON.stringify(json, null, 1);

      const filePath = dir + "/" + counter + ".json";
      Deno.writeTextFileSync(filePath, txt);

      counter++;
    });
  }

  /**
   * Check if a neuron is in focus.
   *
   * @param {number} index - The index of the neuron.
   * @param {number[]} [focusList] - The list of focus indices.
   * @param {Set<number>} [checked] - The set of checked indices.
   * @returns {boolean} True if the neuron is in focus, false otherwise.
   */
  public inFocus(
    index: number,
    focusList?: number[],
    checked: Set<number> = new Set(),
  ): boolean {
    if (!focusList || focusList.length === 0) {
      return true;
    }

    // Issue #1100: Check if the focus list matches the cached focus list.
    // If the focus list is different, clear the cache and update the tracked list.
    // This ensures the cache is only used when the focus list is the same.
    if (!this.isFocusListMatch(focusList)) {
      this.cacheFocus.clear();
      // Store a copy of the focus list to avoid reference issues
      this.cacheFocusList = [...focusList];
    }

    // Check the cache first if there is a focus list
    if (this.cacheFocus.has(index)) {
      return this.cacheFocus.get(index) as boolean;
    }

    if (checked.has(index)) {
      this.cacheFocus.set(index, false);
      return false;
    }

    checked.add(index);

    for (let pos = 0; pos < focusList.length; pos++) {
      const focusIndex = focusList[pos];

      if (index === focusIndex) {
        this.cacheFocus.set(index, true);
        return true;
      }

      const toList = this.inwardConnections(index);

      for (let i = toList.length; i--;) {
        const checkIndx: number = toList[i].from;
        if (checkIndx === index) {
          this.cacheFocus.set(index, true);
          return true;
        }

        if (this.inFocus(checkIndx, focusList, checked)) {
          this.cacheFocus.set(index, true);
          return true;
        }
      }
    }

    this.cacheFocus.set(index, false);
    return false;
  }

  /**
   * Check if the given focus list matches the cached focus list.
   *
   * Issue #1100: Used to detect when the focus cache should be invalidated.
   *
   * @param focusList - The focus list to check
   * @returns true if the focus list matches the cached list
   */
  private isFocusListMatch(focusList: number[]): boolean {
    const cached = this.cacheFocusList;
    if (!cached) {
      return false;
    }
    if (cached.length !== focusList.length) {
      return false;
    }
    for (let i = 0; i < cached.length; i++) {
      if (cached[i] !== focusList[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create a random connection for the neuron at the given index.
   *
   * @param {number} indx - The index of the target neuron.
   * @returns {Synapse | null} The created synapse or null if no connection was made.
   */
  public makeRandomConnection(indx: number): Synapse | null {
    assert(
      Number.isInteger(indx),
      `Index must be an integer, got: ${String(indx)}`,
    );
    assert(
      indx >= 0 && indx < this.neurons.length,
      `Index out of range: ${indx} (neurons length: ${this.neurons.length})`,
    );

    const toType = this.neurons[indx].type;
    assert(toType !== "input", "Can't connect to input");
    assert(toType !== "constant", "Can't connect to constant");

    for (let attempts = 0; attempts < 12; attempts++) {
      const from = Math.min(
        this.neurons.length - this.output - 1,
        // Even when recurrent connections are allowed, `makeRandomConnection()`
        // is used as a repair step for disconnected neurons. A self-loop does
        // not introduce any upstream signal, so it does not "fix" connectivity.
        // We therefore never generate self-loops here.
        Math.floor(Math.random() * indx), // 0..(indx-1)
      );
      const c = this.getSynapse(from, indx);
      if (c === null) {
        return this.connect(
          from,
          indx,
          Synapse.randomWeight(),
        );
      }
    }
    const firstOutputIndex = this.neurons.length - this.output;
    for (let from = 0; from < indx; from++) {
      if (from >= firstOutputIndex) continue;
      const c = this.getSynapse(from, indx);
      if (c === null) {
        return this.connect(
          from,
          indx,
          Synapse.randomWeight(),
        );
      }
    }
    return null;
  }

  /**
   * Fix the structure of the creature.
   */
  fix(options?: {
    /**
     * When true, remove all recurrent connections (both feedback/backward connections and self-loops).
     * Defaults to false (we allow them by default).
     */
    forwardOnly?: boolean;
    /**
     * Remove recursive (back) synapses (from > to).
     * Defaults to false.
     */
    removeBackConnections?: boolean;
    /**
     * Remove self synapses (from === to).
     * Defaults to false.
     */
    removeSelfConnections?: boolean;
  }) {
    const forwardOnly = options?.forwardOnly === true;
    const removeBackConnections = forwardOnly ||
      options?.removeBackConnections === true;
    const removeSelfConnections = forwardOnly ||
      options?.removeSelfConnections === true;

    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const startUUID = CreatureUtil.makeUUID(this);
    this.DEBUG = holdDebug;
    const maxTo = this.neurons.length - 1;
    const minTo = this.input;

    // Merge duplicate synapses (same from/to/type) by summing weights.
    // 29-Dec-2025: This is behaviour-preserving and fixes a long-standing issue
    // where duplicates were silently dropped, changing forward-pass behaviour.
    // See https://github.com/stSoftwareAU/NEAT-AI/issues/976
    const merged = new Map<string, Synapse>();
    const inboundCountsByTo = new Map<number, number>();

    this.synapses.forEach((synapse) => {
      if (removeSelfConnections && synapse.from === synapse.to) {
        return;
      }
      if (removeBackConnections && synapse.from > synapse.to) {
        return;
      }

      if (synapse.to > maxTo) {
        console.debug("Ignoring connection to above max", maxTo, synapse);
        return;
      }
      if (synapse.to < minTo) {
        console.debug("Ignoring connection to below min", minTo, synapse);
        return;
      }

      const typeKey = synapse.type ?? "";
      const key = `${synapse.from}->${synapse.to}:${typeKey}`;

      const existing = merged.get(key);
      if (existing) {
        existing.weight += synapse.weight;
        // Merge tags conservatively (best-effort). If tags are present on either,
        // keep a de-duplicated union by `{name, value}`.
        if (synapse.tags?.length) {
          existing.tags = mergeTagsByNameValue(existing.tags, synapse.tags);
        }
        return;
      }

      merged.set(key, synapse as Synapse);
      inboundCountsByTo.set(
        synapse.to,
        (inboundCountsByTo.get(synapse.to) ?? 0) + 1,
      );
    });

    const tmpSynapses: Synapse[] = [];
    for (const synapse of merged.values()) {
      if (synapse.weight !== 0 && Number.isFinite(synapse.weight)) {
        tmpSynapses.push(synapse);
        continue;
      }

      // Zero weight may as well be removed, except for the last inward connection
      // to an output neuron (we keep one to preserve structural validity).
      if (this.neurons[synapse.to].type === "output") {
        const inbound = inboundCountsByTo.get(synapse.to) ?? 0;
        if (inbound === 1) {
          tmpSynapses.push(synapse);
        }
      }
    }

    this.synapses = tmpSynapses;

    /* Make sure the synapses are sorted */
    this.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      } else {
        return a.from - b.from;
      }
    });

    this.clearCache();

    let neuronRemoved = true;

    while (neuronRemoved) {
      neuronRemoved = false;
      for (
        let pos = this.input;
        pos < this.neurons.length - this.output;
        pos++
      ) {
        if (this.neurons[pos].type === "output") continue;
        if (
          this.outwardConnections(pos).length === 0
        ) {
          if (this.DEBUG) {
            console.debug(
              `fix() removing disconnected neuron ${pos} ${
                this.neurons[pos].uuid
              }`,
            );
          }
          removeHiddenNeuron(this, pos);
          neuronRemoved = true;
          break;
        }
      }
    }

    for (let i = 1; i < this.synapses.length; i++) {
      if (this.synapses[i - 1].from > this.synapses[i].from) {
        console.error(
          "Synapses not sorted",
          this.synapses[i - 1],
          this.synapses[i],
        );
        this.synapses.sort((a, b) => {
          if (a.from === b.from) {
            return a.to - b.to;
          } else {
            return a.from - b.from;
          }
        });
        break;
      }
    }

    this.neurons.forEach((neuron) => {
      neuron.fix();
    });

    if (forwardOnly) {
      this.forwardOnly = true;

      // Once a creature is confirmed forward-only, bump its semantic version to 4.0.0.
      //
      // Backwards compatibility: we never downgrade versions (e.g. 4.1.2 stays 4.1.2).
      // We only bump when the major version is 2.x.x or 3.x.x.
      const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(this.semanticVersion);
      if (match) {
        const major = Number.parseInt(match[1], 10);
        if (major === 2 || major === 3) {
          this.semanticVersion = "4.0.0";
        }
      }
    }

    const tmpDebug = this.DEBUG;
    this.DEBUG = false;
    delete this.uuid;
    const endUUID = CreatureUtil.makeUUID(this);
    this.DEBUG = tmpDebug;
    if (startUUID !== endUUID) {
      delete this.memetic;
    }
  }

  /**
   * Get the output count of the creature.
   *
   * @returns {number} The number of output neurons.
   */
  outputCount(): number {
    return this.output;
  }

  /**
   * Get the node count of the creature.
   *
   * @returns {number} The number of neurons.
   */
  nodeCount(): number {
    return this.neurons.length;
  }

  /**
   * Convert the creature to a JSON object.
   *
   * @returns {CreatureExport} The JSON representation of the creature.
   */
  exportJSON(): CreatureExport {
    if (this.DEBUG) {
      creatureValidate(this);
    }
    const builder = new CreatureExportBuilder(this);
    const exportCreature: CreatureExport = builder.build();

    return exportCreature;
  }

  /**
   * Convert the creature to a trace JSON object.
   *
   * @returns {CreatureTrace} The trace JSON representation of the creature.
   */
  traceJSON(): CreatureTrace {
    const exportCreature = this.exportJSON();

    const state = this.state;
    let exportIndex = 0;
    this.neurons.forEach((n) => {
      if (n.type !== "input") {
        if (n.type !== "constant") {
          const indx = n.index;

          const traceNeuron: NeuronTrace = exportCreature
            .neurons[exportIndex] as NeuronTrace;

          const ns = state.node(indx);
          if (ns.count) {
            (traceNeuron as NeuronTrace).trace = ns;
          }
        }
        exportIndex++;
      }
    });

    this.synapses.forEach((c, indx) => {
      const exportConnection = exportCreature.synapses[indx] as SynapseTrace;
      const cs = state.connection(c.from, c.to);
      if (cs.count) {
        exportConnection.trace = cs;
      }
    });

    return exportCreature as CreatureTrace;
  }

  /**
   * Load the creature from a JSON object.
   *
   * @param {CreatureInternal | CreatureExport} json - The JSON object representing the creature.
   * @param {boolean} validate - Whether to validate the creature after loading.
   */
  loadFrom(json: CreatureInternal | CreatureExport, validate: boolean) {
    this.uuid = (json as CreatureInternal).uuid;
    if (json.semanticVersion) {
      this.semanticVersion = json.semanticVersion;
    }
    this.forwardOnly = (json as CreatureExport).forwardOnly;

    // Preallocate arrays
    const neuronCount = json.neurons.length;
    const synapseCount = json.synapses.length;
    this.neurons = new Array(neuronCount);
    this.synapses = new Array(synapseCount);

    if (json.tags) {
      this.tags = [...json.tags];
    }

    this.clearState();
    const state = this.state;
    const uuidMap = new Map<string, number>();

    // Optimize input neuron initialization
    let i = json.input;
    while (i--) {
      const key = `input-${i}`;
      uuidMap.set(key, i);
      const n = new Neuron(key, "input", 0, this);
      n.index = i;
      this.neurons[i] = n;
    }

    let pos = json.input;
    let outputIndex = 0;
    const neurons = json.neurons;

    // Process remaining neurons
    for (let i = 0; i < neurons.length; i++) {
      const jn = neurons[i];

      if (jn.type === "input") continue;

      if (jn.type === "output") {
        (jn as { uuid: string }).uuid = `output-${outputIndex++}`;
      }

      const n = Neuron.fromJSON(jn, this);
      n.index = pos;

      if ((jn as NeuronTrace).trace) {
        Object.assign(state.node(n.index), (jn as NeuronTrace).trace);
      }

      uuidMap.set(n.uuid, pos);
      this.neurons[pos++] = n;
    }

    // Optimize synapse processing
    const synapses = json.synapses;
    let isSorted = true;
    let lastFrom = -1;
    let lastTo = -1;
    for (let i = 0; i < synapseCount; i++) {
      const synapse = synapses[i];
      const se = synapse as SynapseExport;
      const from = se.fromUUID
        ? uuidMap.get(se.fromUUID)
        : (synapse as SynapseInternal).from;

      assert(from !== undefined, "FROM is undefined");

      const to = se.toUUID
        ? uuidMap.get(se.toUUID)
        : (synapse as SynapseInternal).to;

      if (to === undefined) {
        fail(
          `TO is undefined: uuid ${se.toUUID}, index ${
            (synapse as SynapseInternal).to
          }`,
        );
      }

      if (isSorted) {
        if (from > lastFrom) {
          lastFrom = from;
          lastTo = -1;
        } else if (from < lastFrom || to <= lastTo) {
          isSorted = false;
        }
        lastTo = to;
      }

      const tmpSynapse = new Synapse(from!, to!, synapse.weight, synapse.type);
      this.synapses[i] = tmpSynapse;

      if (synapse.tags) {
        tmpSynapse.tags = synapse.tags.slice();
      }

      if ((synapse as SynapseTrace).trace) {
        Object.assign(
          state.connection(tmpSynapse.from, tmpSynapse.to),
          (synapse as SynapseTrace).trace,
        );
      }
    }

    this.memetic = json.memetic;
    this.clearCache();

    // Perform sorting only if needed
    if (!isSorted) {
      this.synapses.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        return a.to - b.to;
      });
    }

    // Issue #1097: Prebuild inward index for large creatures after loading.
    // This optimises subsequent inward connection lookups by avoiding
    // linear scans before the lazy index build threshold is reached.
    this.prebuildInwardIndexIfLarge();

    if (validate) {
      creatureValidate(this);
    }
  }

  /**
   * Convert a json object to a creature
   */
  static fromJSON(
    json: CreatureInternal | CreatureExport,
    validate = false,
  ): Creature {
    const semanticVersion = json.semanticVersion ?? "0.0.1";
    if (semanticVersion.startsWith("0.")) {
      json = upgradeOne(json);
    }

    const creature = new Creature(json.input, json.output, {
      lazyInitialization: true,
      semanticVersion: json.semanticVersion,
    });

    const legacy = (json as unknown) as {
      nodes?: [];
      neurons?: [];
      connections?: [];
      synapses?: [];
    };
    if (legacy.nodes) {
      legacy.neurons = legacy.nodes;
      delete legacy.nodes;
    }
    if (legacy.connections) {
      legacy.synapses = legacy.connections;
      delete legacy.connections;
    }
    creature.loadFrom(json, validate);

    return creature;
  }

  /**
   * Creates a shallow clone of this creature.
   *
   * This method is significantly faster than using fromJSON(exportJSON())
   * because it avoids JSON serialisation/deserialisation overhead.
   *
   * The clone:
   * - Has its own independent arrays for neurons and synapses
   * - Copies mutable state (uuid, score, memetic, tags)
   * - Produces identical activation outputs as the original
   * - Can be safely modified without affecting the original
   *
   * Issue #1025: Performance optimisation for fittest creature tracking.
   *
   * @returns A new Creature instance that is a shallow clone of this creature
   */
  shallowClone(): Creature {
    const clone = new Creature(this.input, this.output, {
      lazyInitialization: true,
      semanticVersion: this.semanticVersion,
    });

    // Copy basic properties
    clone.uuid = this.uuid;
    clone.score = this.score;
    clone.forwardOnly = this.forwardOnly;
    clone.DEBUG = this.DEBUG;

    // Copy memetic (shallow copy is sufficient as it's treated as immutable)
    if (this.memetic) {
      clone.memetic = { ...this.memetic };
    }

    // Copy tags (shallow copy of array, each tag is immutable)
    if (this.tags) {
      clone.tags = [...this.tags];
    }

    // Copy cached score components
    if (this.cachedScoreComponents) {
      clone.cachedScoreComponents = { ...this.cachedScoreComponents };
    }

    // Copy neurons - create new Neuron instances to ensure independence
    const neuronCount = this.neurons.length;
    clone.neurons = new Array(neuronCount);

    for (let i = 0; i < this.input; i++) {
      const original = this.neurons[i];
      const neuron = new Neuron(original.uuid, "input", 0, clone);
      neuron.index = i;
      // Neuron.tags has type 'undefined' but can hold TagInterface[] at runtime
      // via TagsInterface. We copy the array if present.
      const originalTags = original.tags as TagInterface[] | undefined;
      if (originalTags) {
        (neuron as { tags: TagInterface[] | undefined }).tags = [
          ...originalTags,
        ];
      }
      clone.neurons[i] = neuron;
    }

    for (let i = this.input; i < neuronCount; i++) {
      const original = this.neurons[i];
      const neuron = new Neuron(
        original.uuid,
        original.type,
        original.bias,
        clone,
        original.squash,
      );
      neuron.index = i;
      // Neuron.tags has type 'undefined' but can hold TagInterface[] at runtime
      // via TagsInterface. We copy the array if present.
      const originalTags = original.tags as TagInterface[] | undefined;
      if (originalTags) {
        (neuron as { tags: TagInterface[] | undefined }).tags = [
          ...originalTags,
        ];
      }
      clone.neurons[i] = neuron;
    }

    // Copy synapses - create new Synapse instances to ensure independence
    const synapseCount = this.synapses.length;
    clone.synapses = new Array(synapseCount);

    for (let i = 0; i < synapseCount; i++) {
      const original = this.synapses[i];
      const synapse = new Synapse(
        original.from,
        original.to,
        original.weight,
        original.type,
      );
      if (original.tags) {
        synapse.tags = [...original.tags];
      }
      clone.synapses[i] = synapse;
    }

    return clone;
  }
}
