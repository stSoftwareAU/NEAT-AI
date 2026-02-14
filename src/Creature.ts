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
import { getGlobalDebug } from "./globalAccessors.ts";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "./architecture/CreatureInterfaces.ts";
import { CreatureState } from "./architecture/CreatureState.ts";
import { creatureValidate } from "./architecture/CreatureValidate.ts";
import type { DataRecordInterface } from "./architecture/DataSet.ts";
import type { DiscoverRecord } from "./architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Neuron } from "./architecture/Neuron.ts";
import { Synapse } from "./architecture/Synapse.ts";
import type { SynapseInternal } from "./architecture/SynapseInterfaces.ts";
import type { MemeticInterface } from "./blackbox/MemeticInterface.ts";
import { compactCreature } from "./compact/CompactCreature.ts";
import type { NeatOptions } from "./config/NeatOptions.ts";
import type { CostInterface } from "./costs/CostInterface.ts";
import { Activations } from "./methods/activations/Activations.ts";
import type { BackPropagationConfig } from "./propagate/BackPropagation.ts";
import type { SparseConfig } from "./propagate/sparse/SparseConfig.ts";
import type { SparseConfigLike } from "./propagate/sparse/SparseConfigLike.ts";
import type { WasmCreatureActivation } from "./wasm/mod.ts";
import { getRandomNumberGenerator } from "./utils/RandomNumberGenerator.ts";

// Extracted modules
import * as activation from "./creature/CreatureActivation.ts";
import * as topology from "./creature/CreatureTopology.ts";
import type { TopologyCaches } from "./creature/CreatureTopology.ts";
import * as training from "./creature/CreatureTraining.ts";
import * as serialisation from "./creature/CreatureSerialization.ts";
import * as mutation from "./creature/CreatureMutation.ts";
import type {
  DiscoveryDirResult,
  DiscoveryRunnerLike,
} from "./discovery/DiscoveryRunner.ts";
import type {
  DiscoveryReplayDirResult,
  DiscoveryReplayRunnerLike,
} from "./discovery/DiscoveryReplayRunner.ts";

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
  readonly state: CreatureState = new CreatureState(this);

  // Topology caches (managed by CreatureTopology module)
  private _topoCaches: TopologyCaches = {
    cacheTo: new Map(),
    cacheFrom: new Map(),
    cacheSelf: new Map(),
    synapsesIndexedByTo: null,
    connectionSet: null,
    availableConnectionsCache: null,
    hiddenNeuronUUIDs: null,
    inwardCacheMissCount: 0,
  };

  // Focus cache (separate from topology caches per Issue #1100)
  private cacheFocus: Map<number, boolean> = new Map();
  private cacheFocusList: number[] | undefined = undefined;

  /** The version of this creature */
  public semanticVersion: string;
  public forwardOnly?: boolean;
  public cachedScoreComponents?: CachedScoreComponents;
  public topologyHash?: string;

  // WASM activation state (managed by CreatureActivation module)
  /** @internal */
  cachedWasmActivation?: WasmCreatureActivation;
  /** @internal */
  wasmEligibilityCache?: boolean;

  DEBUG: boolean = getGlobalDebug();

  /** @deprecated Use PREBUILD_SYNAPSE_THRESHOLD from creature/CreatureTopology.ts */
  public static readonly PREBUILD_SYNAPSE_THRESHOLD =
    topology.PREBUILD_SYNAPSE_THRESHOLD;

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
   * hiddenNeuronUUIDs is preserved because adding/removing a connection
   * does not change the set of neurons.
   */
  public clearCache(from: number = -1, to: number = -1) {
    if (from === -1 || to === -1) {
      // Full invalidation: clears everything including hiddenNeuronUUIDs.
      // Used when neurons are added/removed or structure is fully rebuilt.
      this._topoCaches.cacheTo.clear();
      this._topoCaches.cacheFrom.clear();
      this._topoCaches.cacheSelf.clear();
      this._topoCaches.synapsesIndexedByTo = null;
      this._topoCaches.inwardCacheMissCount = 0;
      this._topoCaches.connectionSet = null;
      this._topoCaches.hiddenNeuronUUIDs = null;
      this._topoCaches.availableConnectionsCache = null;
      this.topologyHash = undefined;
    } else {
      // Connection-only invalidation: preserves hiddenNeuronUUIDs.
      // Adding/removing a connection does not change the set of neurons,
      // so the UUID set remains valid.
      this._topoCaches.cacheTo.delete(to);
      this._topoCaches.cacheFrom.delete(from);
      this._topoCaches.cacheSelf.delete(from);
      this._topoCaches.synapsesIndexedByTo = null;
      this._topoCaches.inwardCacheMissCount = 0;
      this._topoCaches.connectionSet = null;
      this._topoCaches.availableConnectionsCache = null;
      this.topologyHash = undefined;
    }
    this.invalidateScoreCache();
  }

  /**
   * Clears connection-related caches without invalidating hiddenNeuronUUIDs.
   *
   * Issue #1445: Used by batch connect/disconnect operations that change
   * connections but not the set of neurons. This avoids unnecessary
   * rebuilds of the hiddenNeuronUUIDs set.
   */
  private clearConnectionCaches() {
    this._topoCaches.cacheTo.clear();
    this._topoCaches.cacheFrom.clear();
    this._topoCaches.cacheSelf.clear();
    this._topoCaches.synapsesIndexedByTo = null;
    this._topoCaches.inwardCacheMissCount = 0;
    this._topoCaches.connectionSet = null;
    this._topoCaches.availableConnectionsCache = null;
    this.topologyHash = undefined;
    this.invalidateScoreCache();
  }

  public clearFocusCache(): void {
    this.cacheFocus.clear();
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
            getRandomNumberGenerator().random() * 0.2 - 0.1,
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
          getRandomNumberGenerator().random() * 0.2 - 0.1,
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
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const neuron = new Neuron(
          `output-${indx}`,
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
          this.connect(i, j, weight);
        }
      }
    }

    if (fixNeeded) {
      this.fix();
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
        throw new Error(
          `Input observation at index ${i} must be a finite number, got ${
            input[i]
          }`,
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
        throw new Error(
          `Input observation at index ${i} must be a finite number, got ${
            input[i]
          }`,
        );
      }
    }
    const effectiveFeedbackLoop = this.forwardOnly === true
      ? false
      : feedbackLoop;
    activation.requireWasmOrThrow(this);
    return activation.activateWasm(this, input, effectiveFeedbackLoop);
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

  compact(feedbackLoop: boolean): Creature | undefined {
    return compactCreature(this, feedbackLoop);
  }

  validate(options?: {
    neurons?: number;
    connections?: number;
    feedbackLoop?: boolean;
    forwardOnly?: boolean;
  }) {
    creatureValidate(this, options);
  }

  // ── Topology ───────────────────────────────────────────────────────────

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

  public getConnectionSet(): Set<string> {
    return topology.getConnectionSet(this, this._topoCaches);
  }

  public hasConnection(from: number, to: number): boolean {
    return topology.hasConnection(this, this._topoCaches, from, to);
  }

  public getHiddenNeuronUUIDs(): Set<string> {
    return topology.getHiddenNeuronUUIDs(this, this._topoCaches);
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

    const batchSet = new Set<string>();
    for (const conn of connections) {
      const key = `${conn.from}-${conn.to}`;
      if (batchSet.has(key)) {
        throw new Error(`Duplicate connection in batch: ${key} already exists`);
      }
      batchSet.add(key);
    }

    for (const conn of connections) {
      const existing = topology.binarySearchSynapse(this, conn.from, conn.to);
      if (existing !== -1) {
        throw new Error(
          `Connection ${conn.from}->${conn.to} already exists in creature`,
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

    // Issue #1445: Preserve hiddenNeuronUUIDs — batch connect only changes
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

    // Issue #1445: Preserve hiddenNeuronUUIDs — batch disconnect only changes
    // connections, not the set of neurons.
    this.clearConnectionCaches();
  }

  // ── Focus ──────────────────────────────────────────────────────────────

  public inFocus(
    index: number,
    focusList?: number[],
    checked: Set<number> = new Set(),
  ): boolean {
    const result = topology.inFocus(
      this,
      this._topoCaches,
      this.cacheFocus,
      this.cacheFocusList,
      index,
      focusList,
      checked,
    );
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

  record(expected: Float32Array): Map<string, DiscoverRecord> {
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
  ): Promise<{ error: number }> {
    return activation.evaluateDir(this, dataDir, cost, feedbackLoop);
  }

  // ── Mutation ───────────────────────────────────────────────────────────

  public makeRandomConnection(indx: number): Synapse | null {
    return mutation.makeRandomConnection(this, indx);
  }

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

  exportJSON(): CreatureExport {
    return serialisation.exportJSON(this);
  }

  traceJSON(): CreatureTrace {
    return serialisation.traceJSON(this);
  }

  loadFrom(json: CreatureInternal | CreatureExport, validate: boolean) {
    serialisation.loadFrom(this, json, validate);
  }

  static fromJSON(
    json: CreatureInternal | CreatureExport,
    validate = false,
  ): Creature {
    return serialisation.fromJSON(json, validate, Creature) as Creature;
  }

  shallowClone(): Creature {
    return serialisation.shallowClone(this, Creature) as Creature;
  }
}
