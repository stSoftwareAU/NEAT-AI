/**
 * WasmBatchOps.ts — Batch APIs for amortising WASM boundary crossing overhead.
 *
 * Issue #1960: Groups multiple topology operations into single WASM calls
 * to reduce the per-operation boundary crossing cost (~100-500 ns per call).
 *
 * Provides three batch operations:
 * 1. validateTopologyBatch — validate multiple creature topologies
 * 2. calculateWeightBatch4Way — finalise 4 synapse weights
 * 3. calculateBiasBatch4Way — finalise 4 neuron biases
 *
 * Each function tries the WASM batch implementation first; if WASM is not
 * available, falls back to calling the individual WASM or TypeScript functions.
 */

import type { TypedTopology } from "../architecture/TypedTopology.ts";
import type { BackPropagationConfig } from "../propagate/BackPropagation.ts";
import type { SynapseState } from "../propagate/SynapseState.ts";
import {
  getCalculateBiasBatch4WayFn,
  getCalculateWeightBatch4WayFn,
  getValidateTopologyBatchFn,
} from "./WasmModuleLoader.ts";
import {
  wasmCalculateBias,
  wasmCalculateWeight,
} from "./WasmStandaloneFunctions.ts";
import {
  TOPOLOGY_VALID,
  type TopologyValidationResult,
  validateTopology,
} from "./WasmTopologyOps.ts";

// ---------------------------------------------------------------------------
// Pre-allocated buffers for batch packing
// ---------------------------------------------------------------------------

/** 32 f64 values: 8 per synapse × 4 for calculateWeightBatch4Way */
const _weightPackBuf = new Float64Array(32);

/** 12 f64 values: 3 per neuron × 4 for calculateBiasBatch4Way */
const _biasPackBuf = new Float64Array(12);

/** 4 u8 values: noChange flags for calculateBiasBatch4Way */
const _noChangeBuf = new Uint8Array(4);

// ===========================================================================
// 1. Batch Topology Validation
// ===========================================================================

/**
 * Issue #1960 — Validate multiple creature topologies in a single batch.
 *
 * Uses a dedicated WASM batch function when available to amortise the
 * boundary crossing cost across all topologies. Falls back to calling
 * validateTopology individually for each topology.
 *
 * @param topologies Array of TypedTopology snapshots to validate
 * @returns Array of TopologyValidationResult, one per topology
 */
export function validateTopologyBatch(
  topologies: TypedTopology[],
): TopologyValidationResult[] {
  if (topologies.length === 0) return [];

  const wasmBatchFn = getValidateTopologyBatchFn();
  if (wasmBatchFn) {
    return validateTopologyBatchWasm(topologies, wasmBatchFn);
  }

  // Fallback: call individual validation for each topology
  return topologies.map((topo) => validateTopology(topo));
}

/**
 * WASM batch topology validation implementation.
 * Concatenates all from/to indices and calls WASM once.
 */
function validateTopologyBatchWasm(
  topologies: TypedTopology[],
  wasmFn: (
    allFrom: Uint32Array,
    allTo: Uint32Array,
    lengths: Uint32Array,
  ) => Int32Array,
): TopologyValidationResult[] {
  // Calculate total synapse count
  let totalSynapses = 0;
  for (const topo of topologies) {
    totalSynapses += topo.numSynapses;
  }

  // Concatenate all from/to indices
  const allFrom = new Uint32Array(totalSynapses);
  const allTo = new Uint32Array(totalSynapses);
  const lengths = new Uint32Array(topologies.length);

  let offset = 0;
  for (let i = 0; i < topologies.length; i++) {
    const topo = topologies[i];
    allFrom.set(topo.fromIndices, offset);
    allTo.set(topo.toIndices, offset);
    lengths[i] = topo.numSynapses;
    offset += topo.numSynapses;
  }

  // Single WASM call for all topologies
  const flat = wasmFn(allFrom, allTo, lengths);

  // Unpack results: 2 i32 per topology [errorCode, synapseIndex]
  const results: TopologyValidationResult[] = new Array(topologies.length);
  for (let i = 0; i < topologies.length; i++) {
    const errorCode = flat[i * 2];
    results[i] = {
      valid: errorCode === TOPOLOGY_VALID,
      errorCode,
      synapseIndex: flat[i * 2 + 1],
    };
  }

  return results;
}

// ===========================================================================
// 2. Batch Weight Calculation
// ===========================================================================

/**
 * Issue #1960 — Calculate 4 finalised weights in a single WASM call.
 *
 * Packs 4 synapse states and current weights into a flat Float64Array,
 * calls the batch WASM function once, and returns 4 calculated weights.
 * Falls back to individual wasmCalculateWeight calls if WASM batch is
 * unavailable.
 *
 * @param states Array of 4 SynapseState objects with accumulated data
 * @param currentWeights Array of 4 current synapse weights
 * @param config Backpropagation configuration (shared across all 4)
 * @returns Array of 4 calculated weights
 */
export function calculateWeightBatch4Way(
  states: SynapseState[],
  currentWeights: number[],
  config: BackPropagationConfig,
): number[] {
  const wasmFn = getCalculateWeightBatch4WayFn();
  if (wasmFn) {
    // Pack 8 f64 per synapse into pre-allocated buffer
    for (let i = 0; i < 4; i++) {
      const base = i * 8;
      const cs = states[i];
      _weightPackBuf[base] = cs.count;
      _weightPackBuf[base + 1] = cs.totalPositiveActivation;
      _weightPackBuf[base + 2] = cs.totalNegativeActivation;
      _weightPackBuf[base + 3] = cs.countPositiveActivations;
      _weightPackBuf[base + 4] = cs.countNegativeActivations;
      _weightPackBuf[base + 5] = cs.totalPositiveAdjustedValue;
      _weightPackBuf[base + 6] = cs.totalNegativeAdjustedValue;
      _weightPackBuf[base + 7] = currentWeights[i];
    }

    const result = wasmFn(
      _weightPackBuf,
      config.generations,
      config.plankConstant,
      config.learningRate,
      config.maximumWeightAdjustmentScale,
      config.limitWeightScale,
      config.l1WeightDecay,
      config.l2WeightDecay,
    );

    return [result[0], result[1], result[2], result[3]];
  }

  // Fallback: individual WASM calls
  return [
    wasmCalculateWeight(states[0], currentWeights[0], config),
    wasmCalculateWeight(states[1], currentWeights[1], config),
    wasmCalculateWeight(states[2], currentWeights[2], config),
    wasmCalculateWeight(states[3], currentWeights[3], config),
  ];
}

// ===========================================================================
// 3. Batch Bias Calculation
// ===========================================================================

/**
 * Issue #1960 — Calculate 4 finalised biases in a single WASM call.
 *
 * Packs 4 neuron states into a flat Float64Array, calls the batch WASM
 * function once, and returns 4 calculated biases. Falls back to individual
 * wasmCalculateBias calls if WASM batch is unavailable.
 *
 * @param counts Array of 4 accumulation counts
 * @param totalAdjustedBiases Array of 4 total adjusted bias values
 * @param currentBiases Array of 4 current neuron biases
 * @param noChanges Array of 4 noChange flags
 * @param config Backpropagation configuration (shared across all 4)
 * @returns Array of 4 calculated biases
 */
export function calculateBiasBatch4Way(
  counts: number[],
  totalAdjustedBiases: number[],
  currentBiases: number[],
  noChanges: boolean[],
  config: BackPropagationConfig,
): number[] {
  const wasmFn = getCalculateBiasBatch4WayFn();
  if (wasmFn) {
    // Pack 3 f64 per neuron into pre-allocated buffer
    for (let i = 0; i < 4; i++) {
      const base = i * 3;
      _biasPackBuf[base] = counts[i];
      _biasPackBuf[base + 1] = totalAdjustedBiases[i];
      _biasPackBuf[base + 2] = currentBiases[i];
      _noChangeBuf[i] = noChanges[i] ? 1 : 0;
    }

    const result = wasmFn(
      _biasPackBuf,
      _noChangeBuf,
      config.generations,
      config.plankConstant,
      config.learningRate,
      config.maximumBiasAdjustmentScale,
      config.limitBiasScale,
      config.l1BiasDecay,
      config.l2BiasDecay,
    );

    return [result[0], result[1], result[2], result[3]];
  }

  // Fallback: individual WASM calls
  return [
    wasmCalculateBias(
      counts[0],
      totalAdjustedBiases[0],
      currentBiases[0],
      noChanges[0],
      config,
    ),
    wasmCalculateBias(
      counts[1],
      totalAdjustedBiases[1],
      currentBiases[1],
      noChanges[1],
      config,
    ),
    wasmCalculateBias(
      counts[2],
      totalAdjustedBiases[2],
      currentBiases[2],
      noChanges[2],
      config,
    ),
    wasmCalculateBias(
      counts[3],
      totalAdjustedBiases[3],
      currentBiases[3],
      noChanges[3],
      config,
    ),
  ];
}
