/**
 * TypedTopology — typed array representation of creature topology.
 *
 * Issue #1957: Replace JS object topology with typed arrays for:
 * - Reduced GC pressure (fewer small objects)
 * - WASM serialisation as memcpy instead of field-by-field marshalling
 * - Single source of truth (JS typed arrays)
 * - Incremental adoption alongside existing object-based topology
 *
 * Arrays are parallel — index `i` across neuron arrays refers to the same
 * neuron, and index `j` across synapse arrays refers to the same synapse.
 */

import type { Creature } from "../Creature.ts";
import { getSquashType } from "../wasm/SquashType.ts";
import { getSynapseTypeCode } from "../wasm/CompileToWasm.ts";
import type { TopologyValidationResult } from "../wasm/WasmTopologyOps.ts";
import {
  computeReverseTopologicalOrder as wasmComputeOrder,
  scanAvailableConnections as wasmScanAvailable,
  validateTopology as wasmValidate,
} from "../wasm/WasmTopologyOps.ts";

/**
 * Immutable typed array snapshot of a creature's topology.
 *
 * Neuron arrays are indexed by neuron position (0..numNeurons-1).
 * Synapse arrays are indexed by synapse position (0..numSynapses-1),
 * matching the creature's sorted synapse order (ascending from, then to).
 */
export class TypedTopology {
  /** Bias for each neuron. Input neurons store 0 (not Infinity). */
  readonly biases: Float64Array;

  /** WASM squash type enum for each neuron (see SquashType). */
  readonly squashTypes: Uint8Array;

  /** Source neuron index for each synapse. */
  readonly fromIndices: Uint32Array;

  /** Destination neuron index for each synapse. */
  readonly toIndices: Uint32Array;

  /** Weight for each synapse. */
  readonly weights: Float64Array;

  /** WASM synapse type code for each synapse (see SynapseTypeCode). */
  readonly synapseTypes: Uint8Array;

  /**
   * Per-neuron constant flag: 1 if the neuron is a constant, 0 otherwise.
   * Required for WASM binary compilation which encodes isConstant per neuron.
   */
  readonly isConstant: Uint8Array;

  /** Total number of neurons (input + hidden + output + constant). */
  readonly numNeurons: number;

  /** Number of input neurons. */
  readonly numInputs: number;

  /** Number of output neurons. */
  readonly numOutputs: number;

  /** Total number of synapses. */
  readonly numSynapses: number;

  private constructor(
    biases: Float64Array,
    squashTypes: Uint8Array,
    fromIndices: Uint32Array,
    toIndices: Uint32Array,
    weights: Float64Array,
    synapseTypes: Uint8Array,
    isConstant: Uint8Array,
    numNeurons: number,
    numInputs: number,
    numOutputs: number,
    numSynapses: number,
  ) {
    this.biases = biases;
    this.squashTypes = squashTypes;
    this.fromIndices = fromIndices;
    this.toIndices = toIndices;
    this.weights = weights;
    this.synapseTypes = synapseTypes;
    this.isConstant = isConstant;
    this.numNeurons = numNeurons;
    this.numInputs = numInputs;
    this.numOutputs = numOutputs;
    this.numSynapses = numSynapses;
  }

  /**
   * Build a TypedTopology snapshot from a Creature's current state.
   *
   * The creature's neurons and synapses are read once and packed into
   * typed arrays. The resulting object is a frozen snapshot — subsequent
   * mutations to the creature are not reflected.
   */
  static fromCreature(creature: Creature): TypedTopology {
    const numNeurons = creature.neurons.length;
    const numSynapses = creature.synapses.length;
    const numInputs = creature.input;
    const numOutputs = creature.output;

    // Neuron arrays
    const biases = new Float64Array(numNeurons);
    const squashTypes = new Uint8Array(numNeurons);
    const isConstant = new Uint8Array(numNeurons);

    for (let i = 0; i < numNeurons; i++) {
      const neuron = creature.neurons[i];
      biases[i] = neuron.type === "input" ? 0 : neuron.bias;
      squashTypes[i] = getSquashType(neuron.squash);
      isConstant[i] = neuron.type === "constant" ? 1 : 0;
    }

    // Synapse arrays
    const fromIndices = new Uint32Array(numSynapses);
    const toIndices = new Uint32Array(numSynapses);
    const weights = new Float64Array(numSynapses);
    const synapseTypesArr = new Uint8Array(numSynapses);

    for (let i = 0; i < numSynapses; i++) {
      const synapse = creature.synapses[i];
      fromIndices[i] = synapse.from;
      toIndices[i] = synapse.to;
      weights[i] = synapse.weight;
      synapseTypesArr[i] = getSynapseTypeCode(synapse.type);
    }

    return new TypedTopology(
      biases,
      squashTypes,
      fromIndices,
      toIndices,
      weights,
      synapseTypesArr,
      isConstant,
      numNeurons,
      numInputs,
      numOutputs,
      numSynapses,
    );
  }

  /**
   * Compile this typed topology to the WASM activation binary format.
   *
   * The output is byte-identical to `compileCreatureToWasm()` but avoids
   * the field-by-field object traversal — typed array data is copied in
   * bulk where possible.
   *
   * Binary layout (little-endian):
   * - Header: u32 numNeurons, u32 numInputs
   * - Per non-input neuron: f64 bias, u8 squashType, u8 isConstant, u16 numSynapses
   *   - Per inward synapse: u16 fromIndex, u8 synapseType, u8 padding, f64 weight
   */
  toWasmBinary(): Uint8Array {
    // Build inward connection index: for each non-input neuron,
    // collect synapse indices that connect TO that neuron.
    const inward: number[][] = new Array(this.numNeurons - this.numInputs);
    for (let i = 0; i < inward.length; i++) {
      inward[i] = [];
    }

    for (let s = 0; s < this.numSynapses; s++) {
      const to = this.toIndices[s];
      if (to >= this.numInputs) {
        inward[to - this.numInputs].push(s);
      }
    }

    // Sort each inward list by fromIndex (matches CompileToWasm behaviour)
    for (const list of inward) {
      list.sort((a, b) => this.fromIndices[a] - this.fromIndices[b]);
    }

    // Calculate total inward synapses
    let totalInward = 0;
    for (const list of inward) {
      totalInward += list.length;
    }

    // Calculate buffer size
    const headerSize = 8;
    const neuronsSize = (this.numNeurons - this.numInputs) * 12;
    const synapsesSize = totalInward * 12;
    const totalSize = headerSize + neuronsSize + synapsesSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Header
    view.setUint32(offset, this.numNeurons, true);
    offset += 4;
    view.setUint32(offset, this.numInputs, true);
    offset += 4;

    // Non-input neurons
    for (let ni = 0; ni < this.numNeurons - this.numInputs; ni++) {
      const neuronIdx = ni + this.numInputs;
      const synapseList = inward[ni];

      // f64 bias
      view.setFloat64(offset, this.biases[neuronIdx], true);
      offset += 8;

      // u8 squash type
      view.setUint8(offset, this.squashTypes[neuronIdx]);
      offset += 1;

      // u8 is_constant
      view.setUint8(offset, this.isConstant[neuronIdx]);
      offset += 1;

      // u16 num_synapses
      view.setUint16(offset, synapseList.length, true);
      offset += 2;

      // Synapses
      for (const si of synapseList) {
        // u16 from_index
        view.setUint16(offset, this.fromIndices[si], true);
        offset += 2;

        // u8 synapse_type
        view.setUint8(offset, this.synapseTypes[si]);
        offset += 1;

        // u8 padding
        view.setUint8(offset, 0);
        offset += 1;

        // f64 weight
        view.setFloat64(offset, this.weights[si], true);
        offset += 8;
      }
    }

    return new Uint8Array(buffer);
  }

  /**
   * Validate forward-only topology constraints.
   *
   * Issue #1959: Uses WASM when available, falls back to TypeScript.
   * Checks synapse sorting, self-connections, and backward connections.
   */
  validateForwardOnly(): TopologyValidationResult {
    return wasmValidate(this);
  }

  /**
   * Scan for available forward-only connection slots.
   *
   * Issue #1959: Uses WASM when available, falls back to TypeScript.
   * Returns all (from, to) pairs where from < to, to >= numInputs,
   * target is not constant, and no connection exists.
   */
  scanAvailableConnections(): [number, number][] {
    return wasmScanAvailable(this);
  }

  /**
   * Compute reverse topological order for backpropagation.
   *
   * Issue #1959: Uses WASM when available, falls back to TypeScript.
   * Returns neuron indices with output neurons first, hidden neurons
   * after their downstream consumers. Input neurons are excluded.
   */
  computeReverseTopologicalOrder(): number[] {
    return wasmComputeOrder(this);
  }
}
