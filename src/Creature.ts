/**
 * Creature.ts - Central coordinating class for AI entities in NEAT.
 *
 * Issue #1409: Refactored from 3,069 lines into a ~500-line facade.
 * Responsibilities are delegated to focused modules in src/creature/:
 * - CreatureActivation.ts  - Forward pass and WASM activation
 * - CreatureTopology.ts    - Neuron/synapse management, connection queries
 * - CreatureTraining.ts    - Training orchestration, evolution, scoring
 * - CreatureSerialization.ts - JSON import/export, cloning
 * - CreatureMutation.ts    - Network structure repair, random connections
 */

import { assert } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import { getGlobalDebug } from "@globalAccessors";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import { CreatureState } from "@architecture/CreatureState.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { DiscoverRecord } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Neuron } from "@architecture/Neuron.ts";
import {
  inputNeuronId,
  nextNeuronId,
  outputNeuronId,
} from "@architecture/NeuronId.ts";
import { Synapse } from "@architecture/Synapse.ts";
import type { SynapseInternal } from "@architecture/SynapseInterfaces.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import type { EvolvableHyperparameters } from "@config/HyperparameterConfig.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { CostInterface } from "@costs/CostInterface.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type { SparseConfigLike } from "@propagate/sparse/SparseConfigLike.ts";
import type { WasmCreatureActivation } from "@wasm/mod.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { rejectRecurrentSynapseIfForwardOnlyCreature } from "@architecture/ForwardOnlySynapseGuard.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";

// Extracted modules
import * as activation from "@creature/CreatureActivation.ts";
import * as topology from "@creature/CreatureTopology.ts";
import type { TopologyCaches } from "@creature/CreatureTopology.ts";
import * as training from "@creature/CreatureTraining.ts";
import * as serialisation from "@creature/CreatureSerialization.ts";
import * as mutation from "@creature/CreatureMutation.ts";
import type {
  DiscoveryDirResult,
  DiscoveryRunnerLike,
} from "@discovery/DiscoveryRunner.ts";
import type {
  DiscoveryReplayDirResult,
  DiscoveryReplayRunnerLike,
} from "@discovery/DiscoveryReplayRunner.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

interface CreatureOptions {
  /**
   * When true, the creature allows recurrent/feedback topology (self- and
   * backward connections). Default false = strictly forward-only.
   */
  feedbackEnabled?: boolean;
  /**
   * Internal: `fromJSON`, `shallowClone`, and legacy tests. Normal
   * `new Creature(i, o)` always uses {@link CURRENT_CREATURE_SEMANTIC_VERSION}.
   */
  semanticVersion?: string;
  lazyInitialization?: boolean;
  layers?: { squash?: string; count: number }[];
  outputLayer?: {
    squash?: string;
  };
}

/**
 * Semantic version for creatures created without a persisted payload (normal
 * constructor). Both forward-only and feedback-enabled fresh creatures use 4.x;
 * {@link Creature.forwardOnly} selects the topology mode.
 */
export const CURRENT_CREATURE_SEMANTIC_VERSION = "4.0.0";

/** @deprecated Use {@link CURRENT_CREATURE_SEMANTIC_VERSION}. */
export const DEFAULT_NEW_CREATURE_SEMANTIC_VERSION =
  CURRENT_CREATURE_SEMANTIC_VERSION;

/**
 * Cached score components to avoid recalculating on every score calculation.
 * Issue #1023: Performance optimisation for large creatures.
 * Issue #1011: Cache weight/bias statistics incrementally.
 * Issue #1045: Added totalWeightBias and countWeightBias for incremental updates.
 * Issue #1442: Added secondMaxWeightBias for O(1) max recovery.
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
  /**
   * Second-highest absolute value among all weights and biases.
   * Issue #1442: Enables O(1) max recovery when the current max is reduced,
   * avoiding an O(n) full scan of all synapses and neurons.
   */
  secondMaxWeightBias: number;
}

/**
 * Creature Class
 *
 * The Creature class represents an AI entity within the NEAT framework.
 * It delegates to focused modules for each responsibility area.
 */
export class Creature implements CreatureInternal {
  uuid?: string;
  input: number;
  output: number;
  neurons: Neuron[];
  tags?: TagInterface[];
  score?: number;
  synapses: Synapse[];
  memetic?: MemeticInterface;
  hyperparameters?: EvolvableHyperparameters;
  readonly state: CreatureState = new CreatureState(this);

  // Topology caches (managed by CreatureTopology module)
  private _topoCaches: TopologyCaches = {
    cacheTo: [],
    cacheFrom: [],
    cacheSelf: [],
    synapsesIndexedByTo: null,
    connectionSet: null,
    availableConnectionsCache: null,
    hiddenNeuronIds: null,
    hiddenNeuronWireKeys: null,
    inwardCacheMissCount: 0,
  };

  // Focus closure cache (separate from topology caches per Issue #1100)
  // Issue #1443: Changed from Map<number, boolean> to Set<number> (BFS closure).
  private focusClosure: Set<number> | null = null;
  private cacheFocusList: number[] | undefined = undefined;

  /** The version of this creature */
  public semanticVersion: string;
  public forwardOnly?: boolean;
  public cachedScoreComponents?: CachedScoreComponents;
  public topologyHash?: string;

  /**
   * Issue #2258: Cached neuron topology key and UUID lookup array.
   * Stable across connection-only structural changes; cleared only
   * when neurons are added or removed.
   * @internal
   */
  _cachedNeuronTopologyKey?: string;
  /** @internal */
  _cachedUuidLookup?: string[];

  /**
   * Cached parsed major version number from semanticVersion.
   * Issue #1535: Avoids re-parsing the version string on every activation.
   * @internal
   */
  cachedMajorVersion: number;

  // WASM activation state (managed by CreatureActivation module)
  /** @internal */
  cachedWasmActivation?: WasmCreatureActivation;
  /** @internal */
  wasmEligibilityCache?: boolean;

  /**
   * Cached typed array topology snapshot.
   * Issue #1957: Invalidated on any structural change (clearCache).
   * @internal
   */
  private cachedTypedTopology?: TypedTopology;

  DEBUG: boolean = getGlobalDebug();

  get forwardOnlyGuaranteed(): boolean {
    return this.forwardOnly === true;
  }

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

    const lazy = options.lazyInitialization === true;
    // Issue #2349: treat empty string as missing — never allow an empty
    // semanticVersion to propagate through the pipeline.
    const providedVersion = options.semanticVersion || undefined;
    if (providedVersion !== undefined) {
      this.semanticVersion = providedVersion;
    } else {
      this.semanticVersion = CURRENT_CREATURE_SEMANTIC_VERSION;
    }

    const major = Number.parseInt(
      this.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    this.cachedMajorVersion = Number.isFinite(major) ? major : 0;

    if (lazy && options.semanticVersion !== undefined) {
      // `loadFrom` will set the real flag from the JSON.
      this.forwardOnly = true;
    } else {
      this.forwardOnly = options.feedbackEnabled === true ? false : true;
    }

    if (!lazy) {
      this.initialize(options);

      // Issue #2190: Always validate forward-only topology after initialisation,
      // not just in DEBUG builds. This is a lightweight check that verifies
      // all synapses satisfy `from < to`.
      this.assertForwardOnlyTopology();

      if (this.DEBUG) {
        creatureValidate(this);
      }
    }
  }

  // ── Forward-only topology assertion ─────────────────────────────────

  /**
   * Lightweight assertion that all synapses satisfy `from < to` in
   * forward-only creatures. Runs unconditionally (not gated by DEBUG)
   * after initialisation to catch topology violations early.
   *
   * Issue #2190: Production builds previously skipped validation of
   * freshly created creatures. This targeted check replaces the full
   * `creatureValidate()` on the hot path.
   *
   * @throws {TopologyError} if any synapse has `from >= to` in a
   *   forward-only creature.
   */
  assertForwardOnlyTopology(): void {
    if (!this.forwardOnly) return;

    for (let i = 0; i < this.synapses.length; i++) {
      const s = this.synapses[i];
      if (s.from >= s.to) {
        throw new TopologyError(
          `Synapse ${i} violates forward-only topology: ` +
            `from ${s.from} must be < to ${s.to} (from < to)`,
          "INVALID_CONNECTION",
        );
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  public dispose() {
    this.clearState();
    this.clearCache();
    this.clearFocusCache();
    this.disposeWasm();
    this.synapses.length = 0;
    this.neurons.length = 0;
  }

  /**
   * Clears topology caches after structural changes.
   *
   * Issue #1445: Selective cache invalidation by mutation type.
   * When called with valid from/to indices (connection-only change),
   * hiddenNeuronIds and hiddenNeuronWireKeys are preserved because adding/removing
   * a connection does not change the set of neurons.
   */
  public clearCache(from: number = -1, to: number = -1) {
    // Issue #1957: Invalidate typed topology cache on any structural change
    this.cachedTypedTopology = undefined;

    if (from === -1 || to === -1) {
      // Full invalidation: clears neuron identity caches.
      // Used when neurons are added/removed or structure is fully rebuilt.
      this._topoCaches.cacheTo = [];
      this._topoCaches.cacheFrom = [];
      this._topoCaches.cacheSelf = [];
      this._topoCaches.synapsesIndexedByTo = null;
      this._topoCaches.inwardCacheMissCount = 0;
      this._topoCaches.connectionSet = null;
      this._topoCaches.hiddenNeuronIds = null;
      this._topoCaches.hiddenNeuronWireKeys = null;
      this._topoCaches.availableConnectionsCache = null;
      this.topologyHash = undefined;
      // Issue #2258: Full invalidation clears neuron topology caches too.
      this._cachedNeuronTopologyKey = undefined;
      this._cachedUuidLookup = undefined;
    } else {
      // Connection-only invalidation: preserves hidden neuron identity caches.
      this._topoCaches.cacheTo[to] = undefined;
      this._topoCaches.cacheFrom[from] = undefined;
      this._topoCaches.cacheSelf[from] = undefined;
      this._topoCaches.synapsesIndexedByTo = null;
      this._topoCaches.inwardCacheMissCount = 0;
      this._topoCaches.connectionSet = null;
      this._topoCaches.availableConnectionsCache = null;
      this.topologyHash = undefined;
    }
    this.invalidateScoreCache();
  }

  /**
   * Clears connection-related caches without invalidating hidden-neuron identity sets.
   *
   * Issue #1445: Used by batch connect/disconnect operations that change
   * connections but not the set of neurons.
   */
  private clearConnectionCaches() {
    // Issue #1957: Invalidate typed topology on connection changes
    this.cachedTypedTopology = undefined;
    this._topoCaches.cacheTo = [];
    this._topoCaches.cacheFrom = [];
    this._topoCaches.cacheSelf = [];
    this._topoCaches.synapsesIndexedByTo = null;
    this._topoCaches.inwardCacheMissCount = 0;
    this._topoCaches.connectionSet = null;
    this._topoCaches.availableConnectionsCache = null;
    this.topologyHash = undefined;
    this.invalidateScoreCache();
  }

  public clearFocusCache(): void {
    this.focusClosure = null;
    this.cacheFocusList = undefined;
  }

  public invalidateScoreCache() {
    this.cachedScoreComponents = undefined;
    this.wasmEligibilityCache = undefined;
  }

  clearState() {
    delete this.score;
    this.state.clear();
    this.disposeWasm();
  }

  // ── Initialisation (private) ───────────────────────────────────────────

  private initialize(options: {
    layers?: { squash?: string; count: number }[];
    outputLayer?: { squash?: string };
  }) {
    let fixNeeded = false;
    for (let i = this.input; i--;) {
      const type = "input";
      const neuron = new Neuron(
        inputNeuronId(this.input - i - 1),
        type,
        0,
        this,
      );
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
            nextNeuronId(),
            "hidden",
            getRandomNumberGenerator().random() * 0.2 - 0.1,
            this,
            tmpSquash,
          );
          neuron.index = this.neurons.length;
          this.neurons.push(neuron);
        }

        // Issue #1643: Push synapses directly instead of using connect()
        // to avoid per-connection O(n) insertion scan and cache invalidation.
        // Connections are added in sorted order (ascending from, then to).
        const tmpOutput = this.output;
        this.output = 0;
        for (let k = lastStartIndx; k <= lastEndIndx; k++) {
          for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
            this.synapses.push(new Synapse(k, l, Synapse.randomWeight()));
          }
        }
        this.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.neurons.length - 1;
      }

      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        let squash = Activations.pickRandomSquash();
        if (options.outputLayer?.squash) {
          squash = options.outputLayer.squash;
        } else {
          fixNeeded = true;
        }
        const neuron = new Neuron(
          outputNeuronId(indx),
          type,
          getRandomNumberGenerator().random() * 0.2 - 0.1,
          this,
          squash,
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
      }

      for (let k = lastStartIndx; k <= lastEndIndx; k++) {
        for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
          this.synapses.push(new Synapse(k, l, Synapse.randomWeight()));
        }
      }
    } else {
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const neuron = new Neuron(
          outputNeuronId(indx),
          type,
          getRandomNumberGenerator().random() * 0.2 - 0.1,
          this,
          Activations.pickRandomSquash(),
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
        fixNeeded = true;
      }

      for (let i = 0; i < this.input; i++) {
        for (let j = this.input; j < this.output + this.input; j++) {
          const weight = getRandomNumberGenerator().random() * this.input *
            Math.sqrt(2 / this.input);
          this.synapses.push(new Synapse(i, j, weight));
        }
      }
    }

    // Issue #1643: Sort synapses once after bulk insertion instead of
    // maintaining sorted order per-connection via connect().
    this.synapses.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });

    if (fixNeeded) {
      // Issue #1643: Fresh construction has no duplicate synapses and no
      // disconnected neurons, so the full fix() (which calls makeUUID() +
      // exportJSON() twice) is unnecessary overhead. Only neuron.fix()
      // is needed to initialise squash-related state, plus a single
      // makeUUID() call to establish the creature's identity.
      for (const neuron of this.neurons) {
        neuron.fix();
      }
      CreatureUtil.makeUUID(this);
    }
  }

  // ── Activation ─────────────────────────────────────────────────────────

  activateAndTrace(
    input: Float32Array,
    feedbackLoop: boolean,
    sparseConfig: SparseConfigLike,
  ): Float32Array {
    for (let i = 0; i < input.length; i++) {
      if (!Number.isFinite(input[i])) {
        throw new ActivationError(
          `Input observation at index ${i} must be a finite number, got ${
            input[i]
          }`,
          "NON_FINITE_INPUT",
          "input",
          input[i],
        );
      }
    }
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;
    activation.requireWasmOrThrow(this);
    return activation.activateAndTraceWasm(
      this,
      input,
      effectiveFeedbackLoop,
      sparseConfig,
    );
  }

  activate(input: Float32Array, feedbackLoop: boolean = false): Float32Array {
    for (let i = 0; i < input.length; i++) {
      if (!Number.isFinite(input[i])) {
        throw new ActivationError(
          `Input observation at index ${i} must be a finite number, got ${
            input[i]
          }`,
          "NON_FINITE_INPUT",
          "input",
          input[i],
        );
      }
    }
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;
    activation.requireWasmOrThrow(this);
    return activation.activateWasm(this, input, effectiveFeedbackLoop);
  }

  /**
   * Activate without caching the WASM CompiledNetwork on this creature.
   *
   * Issue #1504: Use this in data-generation workloads that touch many creatures
   * but only activate each one a small number of times. The CompiledNetwork is
   * freed immediately after use, preventing WASM heap build-up.
   *
   * If the creature already has a cached activation it is reused (and kept).
   */
  activateEphemeral(
    input: Float32Array,
    feedbackLoop: boolean = false,
  ): Float32Array {
    for (let i = 0; i < input.length; i++) {
      if (!Number.isFinite(input[i])) {
        throw new ActivationError(
          `Input observation at index ${i} must be a finite number, got ${
            input[i]
          }`,
          "NON_FINITE_INPUT",
          "input",
          input[i],
        );
      }
    }
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;
    activation.requireWasmOrThrow(this);
    return activation.activateEphemeral(this, input, effectiveFeedbackLoop);
  }

  /** @internal Expose preparedNeurons flag for activation module */
  get preparedNeurons(): boolean {
    return this.state.preparedNeurons;
  }
  set preparedNeurons(value: boolean) {
    this.state.preparedNeurons = value;
  }

  isWasmEligible(): boolean {
    return activation.isWasmEligible(this);
  }

  getUnsupportedWasmSquashFunctions(): string[] {
    return activation.getUnsupportedWasmSquashFunctions(this);
  }

  disposeWasm(): void {
    activation.disposeWasm(this);
  }

  compact(
    feedbackLoop: boolean,
    mcmcTemperature?: number,
  ): Creature | undefined {
    return compactCreature(this, feedbackLoop, mcmcTemperature);
  }

  validate(options?: {
    neurons?: number;
    connections?: number;
    feedbackLoop?: boolean;
    forwardOnly?: boolean;
  }) {
    creatureValidate(this, options);
  }

  /**
   * Switch to strictly forward-only topology. This is the only supported way
   * to enable feed-forward guarantees after construction (mutate/breed must not
   * flip modes implicitly).
   *
   * @param options.repair When true (default), removes recurrent edges via
   *   `fix({ forwardOnly: true })` before validating. That repair can remove
   *   neurons or synapses and clear memetic state — avoid when the creature is
   *   already forward-only valid (fitness cost).
   */
  setForwardOnlyTopology(options: { repair?: boolean } = {}): void {
    const repair = options.repair !== false;
    if (repair) {
      this.fix({ forwardOnly: true });
    }
    creatureValidate(this, { forwardOnly: true });
    this.forwardOnly = true;
    this.clearCache();
  }

  /**
   * Switch to feedback-enabled (recurrent-capable) topology. Does not add
   * recurrent edges — only marks the creature so mutation and activation may
   * use memory/feedback paths.
   */
  setFeedbackEnabledTopology(_options: { repair?: boolean } = {}): void {
    // Validate before mutating flags or version so a failed check cannot leave
    // a partially updated creature (e.g. 4.x + forwardOnly false without passing
    // structural validation).
    creatureValidate(this);
    this.forwardOnly = false;
    this.clearCache();
  }

  // ── Topology ───────────────────────────────────────────────────────────

  /**
   * Build (or return cached) typed array topology snapshot.
   *
   * Issue #1957: Typed array topology for reduced GC pressure and
   * WASM-compatible memcpy serialisation.
   */
  buildTypedTopology(): TypedTopology {
    if (!this.cachedTypedTopology) {
      this.cachedTypedTopology = TypedTopology.fromCreature(this);
    }
    return this.cachedTypedTopology;
  }

  selfConnection(indx: number): SynapseInternal | null {
    return topology.selfConnection(this, this._topoCaches, indx);
  }

  inwardConnections(toIndx: number): Synapse[] {
    return topology.inwardConnections(this, this._topoCaches, toIndx);
  }

  public prebuildInwardIndex(): void {
    topology.prebuildInwardIndex(this, this._topoCaches);
  }

  public isInwardIndexBuilt(): boolean {
    return topology.isInwardIndexBuilt(this._topoCaches);
  }

  public prebuildInwardIndexIfLarge(): void {
    topology.prebuildInwardIndexIfLarge(this, this._topoCaches);
  }

  public bulkLoadInwardConnections(): void {
    topology.bulkLoadInwardConnections(this, this._topoCaches);
  }

  public getConnectionSet(): Set<number> {
    return topology.getConnectionSet(this, this._topoCaches);
  }

  public hasConnection(from: number, to: number): boolean {
    return topology.hasConnection(this, this._topoCaches, from, to);
  }

  public getHiddenNeuronIds(): Set<number> {
    return topology.getHiddenNeuronIds(this, this._topoCaches);
  }

  public getHiddenNeuronWireKeys(): Set<string> {
    return topology.getHiddenNeuronWireKeys(this, this._topoCaches);
  }

  public getAvailableConnections(focusList?: number[]): [number, number][] {
    return topology.getAvailableConnections(
      this,
      this._topoCaches,
      focusList,
      (index, fl) => this.inFocus(index, fl),
    );
  }

  public isAvailableConnectionsCacheBuilt(): boolean {
    return topology.isAvailableConnectionsCacheBuilt(this._topoCaches);
  }

  outwardConnections(fromIndx: number): Synapse[] {
    return topology.outwardConnections(this, this._topoCaches, fromIndx);
  }

  getSynapse(from: number, to: number): Synapse | null {
    return topology.getSynapse(this, this._topoCaches, from, to);
  }

  connect(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ): Synapse {
    rejectRecurrentSynapseIfForwardOnlyCreature(this, from, to);
    const connection = new Synapse(from, to, weight, type);

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
      this.synapses.splice(location, 0, connection);
    } else {
      this.synapses.push(connection);
    }

    // Issue #1445: clearCache(from, to) already calls invalidateScoreCache()
    this.clearCache(from, to);
    return connection;
  }

  disconnect(from: number, to: number) {
    const indx = topology.binarySearchSynapse(this, from, to);
    if (indx !== -1) {
      this.synapses.splice(indx, 1);
      // Issue #1445: clearCache(from, to) already calls invalidateScoreCache()
      this.clearCache(from, to);
    }
  }

  connectBatch(
    connections: Array<{
      from: number;
      to: number;
      weight: number;
      type?: "positive" | "negative" | "condition";
    }>,
  ): void {
    if (connections.length === 0) return;

    for (const conn of connections) {
      rejectRecurrentSynapseIfForwardOnlyCreature(this, conn.from, conn.to);
    }

    const batchSet = new Set<string>();
    for (const conn of connections) {
      const key = `${conn.from}-${conn.to}`;
      if (batchSet.has(key)) {
        throw new TopologyError(
          `Duplicate connection in batch: ${key} already exists`,
          "INVALID_CONNECTION",
        );
      }
      batchSet.add(key);
    }

    for (const conn of connections) {
      const existing = topology.binarySearchSynapse(this, conn.from, conn.to);
      if (existing !== -1) {
        throw new TopologyError(
          `Connection ${conn.from}->${conn.to} already exists in creature`,
          "INVALID_CONNECTION",
        );
      }
    }

    const sortedConnections = [...connections].sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });

    for (const conn of sortedConnections) {
      const synapse = new Synapse(conn.from, conn.to, conn.weight, conn.type);
      const location = topology.findInsertionPoint(this, conn.from, conn.to);
      if (location < this.synapses.length) {
        this.synapses.splice(location, 0, synapse);
      } else {
        this.synapses.push(synapse);
      }
    }

    // Issue #1445: Preserve hiddenNeuronIds — batch connect only changes
    // connections, not the set of neurons.
    this.clearConnectionCaches();
  }

  disconnectBatch(pairs: Array<{ from: number; to: number }>): void {
    if (pairs.length === 0) return;

    const indices: number[] = [];
    for (const pair of pairs) {
      const idx = topology.binarySearchSynapse(this, pair.from, pair.to);
      if (idx !== -1) indices.push(idx);
    }

    if (indices.length === 0) return;

    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      this.synapses.splice(idx, 1);
    }

    // Issue #1445: Preserve hiddenNeuronIds — batch disconnect only changes
    // connections, not the set of neurons.
    this.clearConnectionCaches();
  }

  // ── Transfer Learning (Issue #1861) ─────────────────────────────────────

  /**
   * Freezes or unfreezes a neuron's bias.
   * When frozen, the bias will not be modified by backpropagation or mutation.
   */
  setNeuronFrozen(index: number, frozen: boolean): void {
    const neuron = this.neurons[index];
    neuron.frozen = frozen ? true : undefined;
  }

  /**
   * Freezes or unfreezes a synapse's weight.
   * When frozen, the weight will not be modified by backpropagation or mutation.
   */
  setSynapseFrozen(from: number, to: number, frozen: boolean): void {
    const synapse = this.getSynapse(from, to);
    if (synapse) {
      synapse.frozen = frozen ? true : undefined;
    }
  }

  /**
   * Freezes all hidden neurons and their interconnecting synapses.
   * Useful for transfer learning where only output weights should be trained.
   */
  freezeHiddenLayers(): void {
    for (const neuron of this.neurons) {
      if (neuron.type === "hidden") {
        neuron.frozen = true;
      }
    }
    for (const synapse of this.synapses) {
      const fromNeuron = this.neurons[synapse.from];
      const toNeuron = this.neurons[synapse.to];
      if (fromNeuron.type === "hidden" && toNeuron.type === "hidden") {
        synapse.frozen = true;
      }
    }
  }

  /**
   * Unfreezes all neurons and synapses.
   */
  unfreezeAll(): void {
    for (const neuron of this.neurons) {
      neuron.frozen = undefined;
    }
    for (const synapse of this.synapses) {
      synapse.frozen = undefined;
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────

  public inFocus(
    index: number,
    focusList?: number[],
  ): boolean {
    const result = topology.inFocus(
      this,
      this._topoCaches,
      this.focusClosure,
      this.cacheFocusList,
      index,
      focusList,
    );
    this.focusClosure = result.updatedFocusClosure;
    this.cacheFocusList = result.updatedCacheFocusList;
    return result.result;
  }

  // ── Training ───────────────────────────────────────────────────────────

  applyLearnings(
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): boolean {
    return training.applyLearnings(this, config, sparseConfig);
  }

  propagate(
    expected: Float32Array,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ) {
    training.propagate(this, expected, config, sparseConfig);
  }

  record(expected: Float32Array): Map<number, DiscoverRecord> {
    return training.record(this, expected);
  }

  propagateUpdate(config: BackPropagationConfig, sparseConfig: SparseConfig) {
    training.propagateUpdate(this, config, sparseConfig);
  }

  evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ): Promise<
    { error: number; score: number; time: number; generation: number }
  > {
    return training.evolveDir(this, dataSetDir, options);
  }

  evolveDataSet(
    dataSet: DataRecordInterface[],
    options: NeatOptions,
  ): Promise<{ error: number; score: number; time: number }> {
    return training.evolveDataSet(this, dataSet, options);
  }

  scoreDir(
    dataDir: string,
    options: NeatOptions,
  ): Promise<{ score: number; error: number }> {
    return training.scoreDir(this, dataDir, options);
  }

  discoveryDir(
    dataDir: string,
    options: NeatOptions,
    deps?: { runner?: DiscoveryRunnerLike },
  ): Promise<DiscoveryDirResult> {
    return training.discoveryDir(this, dataDir, options, deps);
  }

  discoveryReplayDir(
    dataDir: string,
    options: NeatOptions,
    deps?: { runner?: DiscoveryReplayRunnerLike },
  ): Promise<DiscoveryReplayDirResult> {
    return training.discoveryReplayDir(this, dataDir, options, deps);
  }

  traceDir(
    dataDir: string,
    options: NeatOptions,
  ): { score: number; error: number } {
    return training.traceDir(this, dataDir, options);
  }

  evaluateDir(
    dataDir: string,
    cost: CostInterface,
    feedbackLoop: boolean,
    outputRanges?: ReadonlyArray<
      import("./config/OutputRangeConfig.ts").RequiredOutputRange
    >,
    cachedFiles?: string[],
    rustScorer?:
      import("./config/RustScorerConfig.ts").RequiredRustScorerConfig,
  ): Promise<{ error: number }> {
    return activation.evaluateDir(
      this,
      dataDir,
      cost,
      feedbackLoop,
      outputRanges,
      cachedFiles,
      rustScorer,
    );
  }

  // ── Mutation ───────────────────────────────────────────────────────────

  public makeRandomConnection(indx: number): Synapse | null {
    return mutation.makeRandomConnection(this, indx);
  }

  /**
   * Structural repair: normalise synapses and topology so validation can pass.
   *
   * Delegates to `fix()` in `CreatureMutation.ts`. Prefer avoiding unnecessary
   * calls during evolution when the creature is already valid, because repairs
   * can remove trained edges or neurons and drop memetic lineage, lowering fitness.
   */
  fix(options?: {
    forwardOnly?: boolean;
    removeBackConnections?: boolean;
    removeSelfConnections?: boolean;
  }) {
    mutation.fix(this, options);
  }

  // ── Serialisation ──────────────────────────────────────────────────────

  outputCount(): number {
    return this.output;
  }

  nodeCount(): number {
    return this.neurons.length;
  }

  /** External export: UUID-only, no runtime integer IDs (Issue #2054). */
  exportJSON(): CreatureExport {
    return serialisation.exportJSON(this);
  }

  /** Wire-only snapshot; equivalent to {@link exportJSON} since Issue #2054. */
  exportSnapshotJSON(): CreatureExport {
    return serialisation.exportSnapshotJSON(this);
  }

  traceJSON(): CreatureTrace {
    return serialisation.traceJSON(this);
  }

  loadFrom(
    json: CreatureInternal | CreatureExport,
    validate: boolean,
    source?: string,
    options?: serialisation.LoadFromOptions,
  ) {
    serialisation.loadFrom(this, json, validate, source, options);
  }

  static fromJSON(
    json: CreatureInternal | CreatureExport,
    validate?: boolean,
    source?: string,
    options?: serialisation.LoadFromOptions,
  ): Creature {
    return serialisation.fromJSON(
      json,
      validate ?? false,
      Creature,
      source,
      options,
    ) as Creature;
  }

  /**
   * Load a creature from persisted JSON (disk, git, worker wire payload from an
   * untrusted store) and apply {@link Creature.fix} plus a single structural
   * validation pass.
   *
   * Applications such as GRQ should call this once when ingesting a genome file
   * or repo checkout, then pass the instance into evolution or training. After
   * that, the library assumes the instance stays valid: internal pipelines do not
   * re-run full structural validation on every step (use {@link Creature.DEBUG}
   * or {@link Creature.validate} while diagnosing bugs). Prefer
   * {@link Creature.fromJSON} for trusted in-process round-trips where you must
   * preserve exact topology and memetic state — {@link Creature.fix} can prune
   * edges and clear memetic lineage when repairs run.
   *
   * `loadFrom` logs and strips recurrent synapses that contradict
   * `forwardOnly: true`. When any strip occurred, it also runs orphan cleanup
   * so stranded hiddens are not left invalid; {@link Creature.fix} and
   * `creatureValidate()` then complete normalisation for this ingest path.
   *
   * Issue #2514: `loadFrom` now throws by default for forward-only
   * recurrent edges so in-process producers can be traced. This
   * persisted-disk path is one of the explicit repair tools that
   * legitimately needs to load historically corrupt JSON, so it opts
   * into `throwOnRecurrent: "never"` to keep the strip+warn behaviour
   * for genuine on-disk genomes from older releases.
   */
  static fromPersistedJSON(
    json: CreatureInternal | CreatureExport,
  ): Creature {
    const creature = serialisation.fromJSON(
      json,
      false,
      Creature,
      "fromPersistedJSON",
      { throwOnRecurrent: "never" },
    ) as Creature;
    creature.fix({ forwardOnly: creature.forwardOnly });
    creatureValidate(creature, { forwardOnly: creature.forwardOnly });
    return creature;
  }

  shallowClone(): Creature {
    return serialisation.shallowClone(this, Creature) as Creature;
  }
}
