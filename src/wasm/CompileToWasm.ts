/**
 * Compile a Creature to a binary format suitable for WASM activation
 *
 * Issue #1116 - WASM prototype for creature activation
 * Issue #1125 - Updated to support aggregate functions (IF, MINIMUM, MAXIMUM)
 *
 * Data format (all values little-endian):
 * - u32: num_neurons
 * - u32: num_inputs
 * - For each non-input neuron:
 *   - f64: bias (matches JS number precision)
 *   - u8: squash_type
 *   - u8: is_constant (0 or 1)
 *   - u16: num_synapses
 *   - For each synapse:
 *     - u16: from_index
 *     - u8: synapse_type (0=standard/positive, 1=condition, 2=negative, 3=positive)
 *     - u8: padding
 *     - f64: weight (matches JS number precision)
 */

import type { Creature } from "../Creature.ts";
import { getSquashType } from "./SquashType.ts";

/**
 * Synapse type enum for WASM - must match Rust SynapseType
 * Used by IF squash function to categorise inputs
 */
export enum SynapseTypeCode {
  /** Standard synapse (no special type) - also used as "positive" for IF */
  Standard = 0,
  /** Condition synapse for IF activation */
  Condition = 1,
  /** Negative synapse for IF activation */
  Negative = 2,
  /** Positive synapse for IF activation (explicit) */
  Positive = 3,
}

/**
 * Map synapse type string to SynapseTypeCode
 */
function getSynapseTypeCode(
  synapseType: "positive" | "negative" | "condition" | undefined,
): SynapseTypeCode {
  switch (synapseType) {
    case "condition":
      return SynapseTypeCode.Condition;
    case "negative":
      return SynapseTypeCode.Negative;
    case "positive":
      return SynapseTypeCode.Positive;
    default:
      return SynapseTypeCode.Standard;
  }
}

/**
 * Compiled creature data for WASM activation
 */
export interface CompiledCreatureData {
  /** Binary data for WASM module */
  data: Uint8Array;
  /** Number of neurons (including inputs) */
  numNeurons: number;
  /** Number of input neurons */
  numInputs: number;
  /** Number of output neurons */
  numOutputs: number;
  /** Total number of synapses */
  numSynapses: number;
}

/**
 * Compile a creature to binary format for WASM activation
 *
 * The creature must be prepared (fix() called) before compilation.
 * The compilation creates a compact binary representation that can be
 * efficiently loaded into WASM memory.
 *
 * Issue #1125: Now includes synapse types for aggregate functions (IF, MINIMUM, MAXIMUM)
 */
export function compileCreatureToWasm(
  creature: Creature,
): CompiledCreatureData {
  const numNeurons = creature.neurons.length;
  const numInputs = creature.input;
  const numOutputs = creature.output;

  // Calculate total size needed
  // Header: 8 bytes (2 x u32)
  // Per non-input neuron: 12 bytes (f64 bias + u8 squash + u8 constant + u16 num_synapses)
  // Per synapse: 12 bytes (u16 from + u8 synapse_type + u8 padding + f64 weight)

  let totalSynapses = 0;
  for (let i = numInputs; i < numNeurons; i++) {
    const inwardList = creature.inwardConnections(i);
    totalSynapses += inwardList.length;
  }

  const headerSize = 8;
  const neuronsSize = (numNeurons - numInputs) * 12;
  const synapsesSize = totalSynapses * 12;
  const totalSize = headerSize + neuronsSize + synapsesSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let offset = 0;

  // Write header
  view.setUint32(offset, numNeurons, true);
  offset += 4;
  view.setUint32(offset, numInputs, true);
  offset += 4;

  // Write each non-input neuron
  for (let i = numInputs; i < numNeurons; i++) {
    const neuron = creature.neurons[i];
    const inwardList = creature.inwardConnections(i);

    // Sort by from index for consistent ordering
    const sortedInward = inwardList.slice().sort((a, b) => a.from - b.from);

    // Write bias (f64)
    view.setFloat64(offset, neuron.bias ?? 0, true);
    offset += 8;

    // Write squash type (u8)
    const squashType = getSquashType(neuron.squash);
    view.setUint8(offset, squashType);
    offset += 1;

    // Write is_constant (u8)
    const isConstant = neuron.type === "constant" ? 1 : 0;
    view.setUint8(offset, isConstant);
    offset += 1;

    // Write num_synapses (u16)
    view.setUint16(offset, sortedInward.length, true);
    offset += 2;

    // Write each synapse
    for (const synapse of sortedInward) {
      // Write from_index (u16)
      view.setUint16(offset, synapse.from, true);
      offset += 2;

      // Write synapse_type (u8) - Issue #1125
      const synapseTypeCode = getSynapseTypeCode(synapse.type);
      view.setUint8(offset, synapseTypeCode);
      offset += 1;

      // Write padding (u8)
      view.setUint8(offset, 0);
      offset += 1;

      // Write weight (f64)
      view.setFloat64(offset, synapse.weight, true);
      offset += 8;
    }
  }

  return {
    data: new Uint8Array(buffer),
    numNeurons,
    numInputs,
    numOutputs,
    numSynapses: totalSynapses,
  };
}

/**
 * Get statistics about a compiled creature
 */
export function getCompiledCreatureStats(
  compiled: CompiledCreatureData,
): string {
  const numHidden = compiled.numNeurons - compiled.numInputs -
    compiled.numOutputs;
  const avgSynapsesPerNeuron =
    (compiled.numSynapses / (compiled.numNeurons - compiled.numInputs))
      .toFixed(1);
  const dataSizeKB = (compiled.data.length / 1024).toFixed(2);

  return `Compiled Creature: ${compiled.numNeurons} neurons ` +
    `(${compiled.numInputs} input, ${numHidden} hidden, ${compiled.numOutputs} output), ` +
    `${compiled.numSynapses} synapses (avg ${avgSynapsesPerNeuron}/neuron), ` +
    `${dataSizeKB} KB`;
}
