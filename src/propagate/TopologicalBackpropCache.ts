/**
 * Issue #3479 — topology-invariant cache for {@link wasmTopologicalBackprop}.
 *
 * `wasmTopologicalBackprop` runs once per training record — millions of times
 * across a full training pass. Most of the work it did per call depended only
 * on the creature's *topology*, which does not change while training a fixed
 * structure: the reverse topological order (a WASM call), the inward-connection
 * mapping, per-neuron type/range/squash data, per-synapse endpoints, and the
 * serialisation buffer layout.
 *
 * This cache computes those artefacts once and reuses them, keyed by the
 * creature's {@link Creature.topologyInvalidationGeneration} counter (bumped on
 * any structural or squash change). The reusable byte buffer holds every
 * topology-invariant field pre-written; each sample only patches the five
 * genuinely value-dependent regions (adjusted activation/bias, hint value,
 * original/adjusted weight) straight into the `DataView`, eliminating the
 * intermediate typed arrays and the redundant second read/write pass.
 *
 * The sparse-selection flags (`propagateNeeded` / `updateNeeded`) depend on the
 * {@link SparseConfig} rather than pure topology, so they are patched whenever
 * the active sparse config changes — stable within a single training pass.
 */

import type { Creature } from "@creature";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { adjustedBias } from "@propagate/Bias.ts";
import { adjustedWeight } from "@propagate/Weight.ts";
import { adjustedActivation } from "@neuron/NeuronPropagation.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";

/** Neuron type constants matching the Rust side. */
const NEURON_TYPE_INPUT = 0;
const NEURON_TYPE_HIDDEN = 1;
const NEURON_TYPE_OUTPUT = 2;
const NEURON_TYPE_CONSTANT = 3;

/** Header size in bytes. */
const HEADER_SIZE = 36;
/** Per-neuron data size in bytes. */
const NEURON_STRIDE = 24;
/** Per-synapse data size in bytes. */
const SYNAPSE_STRIDE = 20;
/** Inward mapping size per neuron. */
const INWARD_MAP_STRIDE = 8;

// Header field offsets.
const H_NEURON_COUNT = 0;
const H_INPUT_COUNT = 4;
const H_OUTPUT_COUNT = 8;
const H_SYNAPSE_COUNT = 12;
const H_ORDER_LEN = 16;
const H_TOTAL_INWARD = 20;
const H_PLANK = 24;
const H_NORMALISE = 32;

// Per-neuron field offsets within NEURON_STRIDE.
const N_SQUASH = 0;
const N_TYPE = 1;
const N_PROPAGATE = 2;
const N_UPDATE = 3;
const N_HINT = 4;
const N_RANGE_LOW = 8;
const N_RANGE_HIGH = 12;
const N_ADJ_ACTIVATION = 16;
const N_ADJ_BIAS = 20;

// Per-synapse field offsets within SYNAPSE_STRIDE.
const S_FROM = 0;
const S_TO = 4;
const S_ORIG_WEIGHT = 8;
const S_ADJ_WEIGHT = 12;
const S_SELF_LOOP = 16;

/**
 * Cached, topology-invariant serialisation state for the topological backprop
 * WASM call. Build once per topology generation via {@link build}; reuse across
 * every training record.
 */
export class TopologicalBackpropCache {
  /** Creature topology generation this cache was built for. */
  generation: number;
  /** Sparse config whose selection flags are currently patched into the buffer. */
  sparseConfig: SparseConfig | undefined;

  /** Reverse topological order (output-first); reused for the WASM buffer and TS fallbacks. */
  readonly order: number[];
  readonly neuronCount: number;
  readonly synapseCount: number;
  readonly outputCount: number;
  readonly totalInward: number;

  /** Reusable serialisation buffer with all topology-invariant fields pre-written. */
  readonly bytes: Uint8Array;

  private readonly view: DataView;
  private readonly synapseBase: number;
  private readonly expectedBase: number;

  /**
   * Per-sample adjusted activations, retained after the WASM call for the
   * recursive `noChangePropagate` fallback (Issue #2416).
   */
  readonly adjActivations: Float32Array;

  private constructor(
    generation: number,
    order: number[],
    neuronCount: number,
    synapseCount: number,
    outputCount: number,
    totalInward: number,
    bytes: Uint8Array,
    view: DataView,
    synapseBase: number,
    expectedBase: number,
  ) {
    this.generation = generation;
    this.sparseConfig = undefined;
    this.order = order;
    this.neuronCount = neuronCount;
    this.synapseCount = synapseCount;
    this.outputCount = outputCount;
    this.totalInward = totalInward;
    this.bytes = bytes;
    this.view = view;
    this.synapseBase = synapseBase;
    this.expectedBase = expectedBase;
    this.adjActivations = new Float32Array(neuronCount);
  }

  /**
   * Build the topology-invariant cache from a creature's current structure.
   *
   * Computes the reverse topological order, the inward-connection mapping, and
   * writes every topology-invariant field (header counts, per-neuron
   * type/range/squash, per-synapse endpoints/self-loop, inward mapping, inward
   * indices, order) into a reusable byte buffer.
   */
  static build(
    creature: Creature,
    generation: number,
  ): TopologicalBackpropCache {
    const neurons = creature.neurons;
    const neuronCount = neurons.length;
    const inputCount = creature.input;
    const outputCount = creature.output;
    const allSynapses = creature.synapses;
    const synapseCount = allSynapses.length;

    // Reverse topological order via the WASM-backed topology ops.
    const order = TypedTopology.fromCreature(creature)
      .computeReverseTopologicalOrder();

    // Synapse lookup: (from, to) → synapse index, used to resolve inward
    // synapses to their global index in O(1).
    const synapseLookup = new Map<number, Map<number, number>>();
    for (let i = 0; i < synapseCount; i++) {
      const s = allSynapses[i];
      let fromMap = synapseLookup.get(s.from);
      if (fromMap === undefined) {
        fromMap = new Map<number, number>();
        synapseLookup.set(s.from, fromMap);
      }
      fromMap.set(s.to, i);
    }

    // Inward connection mapping: for each neuron, the synapse indices that
    // connect inward.
    const inwardStarts = new Uint32Array(neuronCount);
    const inwardCounts = new Uint32Array(neuronCount);
    const inwardIndicesList: number[] = [];
    for (let i = 0; i < neuronCount; i++) {
      const inward = creature.inwardConnections(i);
      inwardStarts[i] = inwardIndicesList.length;
      inwardCounts[i] = inward.length;
      for (const syn of inward) {
        const synIdx = synapseLookup.get(syn.from)?.get(syn.to) ?? -1;
        inwardIndicesList.push(synIdx);
      }
    }
    const totalInward = inwardIndicesList.length;

    // Byte-buffer layout.
    const synapseBase = HEADER_SIZE + neuronCount * NEURON_STRIDE;
    const inwardMapBase = synapseBase + synapseCount * SYNAPSE_STRIDE;
    const inwardIndicesBase = inwardMapBase + neuronCount * INWARD_MAP_STRIDE;
    const orderBase = inwardIndicesBase + totalInward * 4;
    const expectedBase = orderBase + order.length * 4;
    const totalSize = expectedBase + outputCount * 4;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Header — topology-invariant counts. plankConstant / normaliseGradients
    // are config-dependent and written per sample in writeSample().
    view.setUint32(H_NEURON_COUNT, neuronCount, true);
    view.setUint32(H_INPUT_COUNT, inputCount, true);
    view.setUint32(H_OUTPUT_COUNT, outputCount, true);
    view.setUint32(H_SYNAPSE_COUNT, synapseCount, true);
    view.setUint32(H_ORDER_LEN, order.length, true);
    view.setUint32(H_TOTAL_INWARD, totalInward, true);

    // Per-neuron topology-invariant fields.
    for (let i = 0; i < neuronCount; i++) {
      const base = HEADER_SIZE + i * NEURON_STRIDE;
      const n = neurons[i];
      bytes[base + N_SQUASH] = n.cachedSquashType();

      let neuronType: number;
      let rangeLow: number;
      let rangeHigh: number;
      if (n.type === "input") {
        neuronType = NEURON_TYPE_INPUT;
        rangeLow = -Infinity;
        rangeHigh = Infinity;
      } else if (n.type === "constant") {
        neuronType = NEURON_TYPE_CONSTANT;
        rangeLow = -Infinity;
        rangeHigh = Infinity;
      } else {
        neuronType = n.type === "output"
          ? NEURON_TYPE_OUTPUT
          : NEURON_TYPE_HIDDEN;
        const squashMethod = n.findSquash();
        rangeLow = squashMethod.range.low;
        rangeHigh = squashMethod.range.high;
      }

      bytes[base + N_TYPE] = neuronType;
      view.setFloat32(base + N_RANGE_LOW, rangeLow, true);
      view.setFloat32(base + N_RANGE_HIGH, rangeHigh, true);
    }

    // Per-synapse topology-invariant fields.
    for (let i = 0; i < synapseCount; i++) {
      const base = synapseBase + i * SYNAPSE_STRIDE;
      const s = allSynapses[i];
      view.setUint32(base + S_FROM, s.from, true);
      view.setUint32(base + S_TO, s.to, true);
      bytes[base + S_SELF_LOOP] = s.from === s.to ? 1 : 0;
    }

    // Inward mapping (start, count) per neuron.
    for (let i = 0; i < neuronCount; i++) {
      const base = inwardMapBase + i * INWARD_MAP_STRIDE;
      view.setUint32(base, inwardStarts[i], true);
      view.setUint32(base + 4, inwardCounts[i], true);
    }

    // Inward indices.
    for (let i = 0; i < totalInward; i++) {
      view.setUint32(inwardIndicesBase + i * 4, inwardIndicesList[i], true);
    }

    // Reverse topological order.
    for (let i = 0; i < order.length; i++) {
      view.setUint32(orderBase + i * 4, order[i], true);
    }

    return new TopologicalBackpropCache(
      generation,
      order,
      neuronCount,
      synapseCount,
      outputCount,
      totalInward,
      bytes,
      view,
      synapseBase,
      expectedBase,
    );
  }

  /**
   * Patch the sparse-selection flags (`propagateNeeded` / `updateNeeded`) for a
   * given {@link SparseConfig}. These depend on the sparse config, not pure
   * topology, so they are refreshed whenever the active config changes.
   */
  applySparse(creature: Creature, sparseConfig: SparseConfig): void {
    const neurons = creature.neurons;
    const bytes = this.bytes;
    for (let i = 0; i < this.neuronCount; i++) {
      const base = HEADER_SIZE + i * NEURON_STRIDE;
      const id = neurons[i].id;
      bytes[base + N_PROPAGATE] = sparseConfig.propagateNeeded(id) ? 1 : 0;
      bytes[base + N_UPDATE] = sparseConfig.updateNeeded(id) ? 1 : 0;
    }
    this.sparseConfig = sparseConfig;
  }

  /**
   * Write the per-sample, value-dependent fields directly into the reusable
   * buffer: the header config values, adjusted activation/bias and hint value
   * per neuron, original/adjusted weight per synapse, and the expected outputs.
   */
  writeSample(
    creature: Creature,
    config: BackPropagationConfig,
    expected: Float32Array,
  ): void {
    const neurons = creature.neurons;
    const state = creature.state;
    const view = this.view;
    const bytes = this.bytes;
    const adjActivations = this.adjActivations;

    // Config-dependent header fields (stable within a pass, cheap to rewrite).
    bytes[H_NORMALISE] = config.normaliseGradients ? 1 : 0;
    view.setFloat64(H_PLANK, config.plankConstant, true);

    for (let i = 0; i < this.neuronCount; i++) {
      const base = HEADER_SIZE + i * NEURON_STRIDE;
      const n = neurons[i];
      const adjAct = adjustedActivation(n, config);
      adjActivations[i] = adjAct;
      view.setFloat32(base + N_ADJ_ACTIVATION, adjAct, true);

      if (n.type !== "input" && n.type !== "constant") {
        view.setFloat32(base + N_ADJ_BIAS, adjustedBias(n, config), true);
        const ns = state.node(i);
        view.setFloat32(base + N_HINT, ns.hintValue, true);
      }
    }

    const allSynapses = creature.synapses;
    const synapseBase = this.synapseBase;
    for (let i = 0; i < this.synapseCount; i++) {
      const base = synapseBase + i * SYNAPSE_STRIDE;
      const s = allSynapses[i];
      view.setFloat32(base + S_ORIG_WEIGHT, s.weight, true);
      view.setFloat32(
        base + S_ADJ_WEIGHT,
        adjustedWeight(state, s, config),
        true,
      );
    }

    const expectedBase = this.expectedBase;
    for (let i = 0; i < this.outputCount; i++) {
      view.setFloat32(expectedBase + i * 4, expected[i], true);
    }
  }
}
