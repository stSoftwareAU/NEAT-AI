/**
 * Issue #1954 - WASM topological backpropagation serialisation wrapper.
 *
 * Serialises creature state into a binary format for the WASM
 * propagate_topological() function, then deserialises the results
 * back into creature state objects.
 */

import type { Creature } from "@creature";
import type { NeuronActivationInterface } from "@methods/activations/NeuronActivationInterface.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import { adjustedBias } from "@propagate/Bias.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { adjustedWeight } from "@propagate/Weight.ts";
import { adjustedActivation } from "@neuron/NeuronPropagation.ts";
import { BackpropBuffers } from "@propagate/BackpropBuffers.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import { wasmPropagateTopological } from "@wasm/WasmStandaloneFunctions.ts";
import { getPropagateTopologicalFn } from "@wasm/WasmModuleLoader.ts";
import { noChangePropagate } from "@architecture/NoChangePropagate.ts";

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

/**
 * Attempt to run topological backpropagation via WASM.
 *
 * Issue #2416 — the TypeScript fallbacks have been removed; this shim now
 * returns false only when the WASM module is genuinely unavailable. All
 * other cases (batchSize === 1, no-error early-out, in-loop noChange paths)
 * are handled by the canonical Rust implementation in
 * `neat-core/src/topological_backprop.rs` and surfaced through the WASM
 * result buffer.
 */
export function wasmTopologicalBackprop(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): boolean {
  // Early bail: avoid side effects if WASM is unavailable.
  if (!getPropagateTopologicalFn()) {
    return false;
  }

  creature.state.cacheAdjustedActivation.clear();

  // Ensure backpropBuffers is initialised for special neuron TS fallback.
  if (creature.state.backpropBuffers === undefined) {
    creature.state.backpropBuffers = new BackpropBuffers();
  }

  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const inputCount = creature.input;
  const outputCount = creature.output;
  const allSynapses = creature.synapses;
  const synapseCount = allSynapses.length;

  // Get reverse topological order via the WASM-backed topology ops.
  const order = TypedTopology.fromCreature(creature)
    .computeReverseTopologicalOrder();

  // Build synapse lookup: (from, to) → synapse index.
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

  // Build inward connection mapping.
  // For each neuron, store which synapse indices connect inward.
  const inwardStarts = new Uint32Array(neuronCount);
  const inwardCounts = new Uint32Array(neuronCount);
  const inwardIndicesList: number[] = [];

  // Check for special squash types that need TS fallback.
  const hasCustomPropagate = new Uint8Array(neuronCount);

  for (let i = 0; i < neuronCount; i++) {
    const inward = creature.inwardConnections(i);
    inwardStarts[i] = inwardIndicesList.length;
    inwardCounts[i] = inward.length;

    // Map synapses to their global indices using O(1) lookup.
    for (const syn of inward) {
      const synIdx = synapseLookup.get(syn.from)?.get(syn.to) ?? -1;
      inwardIndicesList.push(synIdx);
    }

    // Check for custom propagate method (IF, MAXIMUM, MINIMUM).
    const n = neurons[i];
    if (n.type !== "input" && n.type !== "constant") {
      const squashMethod = n.findSquash();
      const propagateMethod = squashMethod as NeuronActivationInterface;
      if (propagateMethod.propagate !== undefined) {
        hasCustomPropagate[i] = 1;
      }
    }
  }

  const totalInward = inwardIndicesList.length;

  // Pre-compute adjusted values for all neurons and synapses.
  const adjActivations = new Float32Array(neuronCount);
  const adjBiases = new Float32Array(neuronCount);
  const hintValues = new Float32Array(neuronCount);
  const rangeLows = new Float32Array(neuronCount);
  const rangeHighs = new Float32Array(neuronCount);
  const squashTypes = new Uint8Array(neuronCount);
  const neuronTypes = new Uint8Array(neuronCount);
  const propagateNeeded = new Uint8Array(neuronCount);
  const updateNeeded = new Uint8Array(neuronCount);

  for (let i = 0; i < neuronCount; i++) {
    const n = neurons[i];
    adjActivations[i] = adjustedActivation(n, config);
    squashTypes[i] = n.cachedSquashType();

    if (n.type === "input") {
      neuronTypes[i] = NEURON_TYPE_INPUT;
      rangeLows[i] = -Infinity;
      rangeHighs[i] = Infinity;
    } else if (n.type === "constant") {
      neuronTypes[i] = NEURON_TYPE_CONSTANT;
      rangeLows[i] = -Infinity;
      rangeHighs[i] = Infinity;
    } else if (n.type === "output") {
      neuronTypes[i] = NEURON_TYPE_OUTPUT;
      const squashMethod = n.findSquash();
      rangeLows[i] = squashMethod.range.low;
      rangeHighs[i] = squashMethod.range.high;
    } else {
      neuronTypes[i] = NEURON_TYPE_HIDDEN;
      const squashMethod = n.findSquash();
      rangeLows[i] = squashMethod.range.low;
      rangeHighs[i] = squashMethod.range.high;
    }

    if (n.type !== "input" && n.type !== "constant") {
      adjBiases[i] = adjustedBias(n, config);
      const ns = creature.state.node(i);
      hintValues[i] = ns.hintValue;
    }

    propagateNeeded[i] = sparseConfig.propagateNeeded(n.id) ? 1 : 0;
    updateNeeded[i] = sparseConfig.updateNeeded(n.id) ? 1 : 0;
  }

  const adjWeights = new Float32Array(synapseCount);
  const origWeights = new Float32Array(synapseCount);
  const synFrom = new Uint32Array(synapseCount);
  const synTo = new Uint32Array(synapseCount);
  const isSelfLoop = new Uint8Array(synapseCount);

  for (let i = 0; i < synapseCount; i++) {
    const s = allSynapses[i];
    synFrom[i] = s.from;
    synTo[i] = s.to;
    origWeights[i] = s.weight;
    adjWeights[i] = adjustedWeight(creature.state, s, config);
    isSelfLoop[i] = s.from === s.to ? 1 : 0;
  }

  // ---- Serialise to binary format ----
  const totalSize = HEADER_SIZE +
    neuronCount * NEURON_STRIDE +
    synapseCount * SYNAPSE_STRIDE +
    neuronCount * INWARD_MAP_STRIDE +
    totalInward * 4 +
    order.length * 4 +
    outputCount * 4;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, neuronCount, true);
  offset += 4;
  view.setUint32(offset, inputCount, true);
  offset += 4;
  view.setUint32(offset, outputCount, true);
  offset += 4;
  view.setUint32(offset, synapseCount, true);
  offset += 4;
  view.setUint32(offset, order.length, true);
  offset += 4;
  view.setUint32(offset, totalInward, true);
  offset += 4;
  view.setFloat64(offset, config.plankConstant, true);
  offset += 8;
  bytes[offset] = config.normaliseGradients ? 1 : 0;
  offset += 1;
  bytes[offset] = 0;
  offset += 1; // padding
  bytes[offset] = 0;
  offset += 1; // padding
  bytes[offset] = 0;
  offset += 1; // padding

  // Per-neuron data
  for (let i = 0; i < neuronCount; i++) {
    bytes[offset] = squashTypes[i];
    offset += 1;
    bytes[offset] = neuronTypes[i];
    offset += 1;
    bytes[offset] = propagateNeeded[i];
    offset += 1;
    bytes[offset] = updateNeeded[i];
    offset += 1;
    view.setFloat32(offset, hintValues[i], true);
    offset += 4;
    view.setFloat32(offset, rangeLows[i], true);
    offset += 4;
    view.setFloat32(offset, rangeHighs[i], true);
    offset += 4;
    view.setFloat32(offset, adjActivations[i], true);
    offset += 4;
    view.setFloat32(offset, adjBiases[i], true);
    offset += 4;
  }

  // Per-synapse data
  for (let i = 0; i < synapseCount; i++) {
    view.setUint32(offset, synFrom[i], true);
    offset += 4;
    view.setUint32(offset, synTo[i], true);
    offset += 4;
    view.setFloat32(offset, origWeights[i], true);
    offset += 4;
    view.setFloat32(offset, adjWeights[i], true);
    offset += 4;
    bytes[offset] = isSelfLoop[i];
    offset += 1;
    bytes[offset] = 0;
    offset += 1; // padding
    bytes[offset] = 0;
    offset += 1; // padding
    bytes[offset] = 0;
    offset += 1; // padding
  }

  // Inward mapping
  for (let i = 0; i < neuronCount; i++) {
    view.setUint32(offset, inwardStarts[i], true);
    offset += 4;
    view.setUint32(offset, inwardCounts[i], true);
    offset += 4;
  }

  // Inward indices
  for (let i = 0; i < totalInward; i++) {
    view.setUint32(offset, inwardIndicesList[i], true);
    offset += 4;
  }

  // Reverse topological order
  for (let i = 0; i < order.length; i++) {
    view.setUint32(offset, order[i], true);
    offset += 4;
  }

  // Expected outputs
  for (let i = 0; i < outputCount; i++) {
    view.setFloat32(offset, expected[i], true);
    offset += 4;
  }

  // ---- Call WASM ----
  const result = wasmPropagateTopological(bytes);
  if (result === undefined) {
    return false;
  }

  // ---- Deserialise results ----
  const neuronResultStride = 7;
  const synapseResultStride = 7;
  const state = creature.state;

  // Check if any neurons need the custom-propagate handler (IF/MAXIMUM/MINIMUM)
  // and collect any neurons that hit the WASM-side noChange path so that the
  // recursive parent-marking semantics of `noChangePropagate` can be applied
  // afterwards in TS. Issue #2416.
  let needsTsFallback = false;
  const noChangeNeurons: number[] = [];

  for (let i = 0; i < neuronCount; i++) {
    const nbase = i * neuronResultStride;
    const totalErrorDelta = result[nbase];
    const cachedAct = result[nbase + 1];
    const noChange = result[nbase + 2];
    const biasCountDelta = result[nbase + 3];
    const totalBiasDelta = result[nbase + 4];
    const totalAdjBiasDelta = result[nbase + 5];
    const traceAct = result[nbase + 6];

    // Check for special neuron sentinel (POSITIVE INFINITY = custom propagate
    // method handled by handleSpecialNeuronFallback below).
    if (cachedAct === Infinity) {
      needsTsFallback = true;
      continue;
    }

    if (totalErrorDelta > 0) {
      const ns = state.node(i);
      ns.totalErrorAbsolute += totalErrorDelta;
    }

    // NEGATIVE INFINITY signals the in-loop noChange path on the WASM side —
    // the cached activation is intentionally absent for those neurons. Skip
    // the cache write here; the recursive `noChangePropagate` pass below will
    // populate the cache, the noChange flag, the trace, and bias accumulators
    // exactly as the original TS implementation did.
    if (cachedAct === -Infinity) {
      noChangeNeurons.push(i);
      continue;
    }

    if (!isNaN(cachedAct)) {
      state.cacheAdjustedActivation.set(i, cachedAct);
    }

    if (noChange > 0.5) {
      const ns = state.node(i);
      ns.noChange = true;
    }

    if (biasCountDelta > 0) {
      const ns = state.node(i);
      ns.count += biasCountDelta;
      ns.totalBias += totalBiasDelta;
      ns.totalAdjustedBias += totalAdjBiasDelta;
    }

    if (!isNaN(traceAct)) {
      const ns = state.node(i);
      ns.traceActivation(traceAct);
    }
  }

  // Apply `noChangePropagate` for every neuron that WASM flagged with the
  // NEG_INFINITY sentinel. This walks upstream and marks dependent parents as
  // noChange + records their trace activations — semantics that the WASM core
  // intentionally delegates back to TS.
  if (noChangeNeurons.length > 0) {
    for (const neuronIndex of noChangeNeurons) {
      const neuron = neurons[neuronIndex];
      const activation = adjActivations[neuronIndex];
      noChangePropagate(neuron, activation, config);
      state.cacheAdjustedActivation.set(neuronIndex, activation);
    }
  }

  // Apply synapse state updates.
  for (let i = 0; i < synapseCount; i++) {
    const sbase = neuronCount * neuronResultStride + i * synapseResultStride;
    const countDelta = result[sbase];
    if (countDelta > 0) {
      const syn = allSynapses[i];
      const cs = state.connection(syn.from, syn.to);
      cs.count += countDelta;
      cs.totalPositiveActivation += result[sbase + 1];
      cs.totalNegativeActivation += result[sbase + 2];
      cs.countPositiveActivations += result[sbase + 3];
      cs.countNegativeActivations += result[sbase + 4];
      cs.totalPositiveAdjustedValue += result[sbase + 5];
      cs.totalNegativeAdjustedValue += result[sbase + 6];
    }
  }

  // If any neurons need TS fallback, handle them with the original TS code.
  if (needsTsFallback) {
    handleSpecialNeuronFallback(
      creature,
      expected,
      config,
      sparseConfig,
      result,
      order,
    );
  }

  return true;
}

/**
 * Handle IF/MAXIMUM/MINIMUM neurons that WASM skipped.
 * These neurons have custom propagate() methods.
 */
function handleSpecialNeuronFallback(
  creature: Creature,
  _expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
  wasmResult: Float64Array,
  order: number[],
): void {
  const neurons = creature.neurons;
  const neuronResultStride = 7;
  const state = creature.state;

  // Rebuild target delta from WASM result for context.
  // The WASM function already distributed error for standard neurons.
  // For special neurons, we need to process them with their custom logic.

  // Build targetDeltaSum/Count from the WASM pass for the special neurons.
  // The sentinel value (INFINITY in cachedAct) marks neurons needing fallback.
  // The target activation is stored in traceActivation slot.

  for (let orderIdx = 0; orderIdx < order.length; orderIdx++) {
    const neuronIndex = order[orderIdx];
    const nbase = neuronIndex * neuronResultStride;
    const cachedAct = wasmResult[nbase + 1];

    if (cachedAct !== Infinity) continue;

    // This neuron needs TS fallback.
    const neuron = neurons[neuronIndex];
    const targetActivation = wasmResult[nbase + 6]; // stored in traceActivation slot

    const squashMethod = neuron.findSquash();
    const propagateMethod = squashMethod as NeuronActivationInterface;

    if (propagateMethod.propagate === undefined) continue;

    const ns = state.node(neuronIndex);
    const upNeeded = sparseConfig.updateNeeded(neuron.id);
    ns.noChange = upNeeded === false;

    const limitedActivation = propagateMethod.propagate(
      neuron,
      targetActivation,
      config,
      sparseConfig,
    );

    if (upNeeded) {
      ns.traceActivation(limitedActivation);
    }
    state.cacheAdjustedActivation.set(neuronIndex, limitedActivation);
  }
}
