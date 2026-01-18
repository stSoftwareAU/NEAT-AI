/**
 * Compile a Creature to a binary format suitable for WASM activation
 *
 * Issue #1116 - WASM prototype for creature activation
 *
 * Data format (all values little-endian):
 * - u32: num_neurons
 * - u32: num_inputs
 * - For each non-input neuron:
 *   - f32: bias
 *   - u8: squash_type
 *   - u8: is_constant (0 or 1)
 *   - u16: num_synapses
 *   - For each synapse:
 *     - u16: from_index
 *     - f32: weight
 */

import type { Creature } from "../Creature.ts";
import { getSquashType } from "./SquashType.ts";

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
 */
export function compileCreatureToWasm(
  creature: Creature,
): CompiledCreatureData {
  const numNeurons = creature.neurons.length;
  const numInputs = creature.input;
  const numOutputs = creature.output;

  // Calculate total size needed
  // Header: 8 bytes (2 x u32)
  // Per non-input neuron: 8 bytes (f32 bias + u8 squash + u8 constant + u16 num_synapses)
  // Per synapse: 6 bytes (u16 from + f32 weight)

  let totalSynapses = 0;
  for (let i = numInputs; i < numNeurons; i++) {
    const inwardList = creature.inwardConnections(i);
    totalSynapses += inwardList.length;
  }

  const headerSize = 8;
  const neuronsSize = (numNeurons - numInputs) * 8;
  const synapsesSize = totalSynapses * 6;
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

    // Write bias (f32)
    view.setFloat32(offset, neuron.bias ?? 0, true);
    offset += 4;

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

      // Write weight (f32)
      view.setFloat32(offset, synapse.weight, true);
      offset += 4;
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
