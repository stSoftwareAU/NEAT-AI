/**
 * WASM Module Loader
 *
 * Issue #1405 - Extracted from WasmActivation.ts as part of facade refactoring.
 *
 * Handles loading, initialisation, and access to the underlying WASM module.
 * Manages function pointer state and provides getters for all WASM-exported
 * functions. This module is an internal implementation detail; callers use
 * the higher-level wrappers in WasmStandaloneFunctions.ts and
 * WasmCreatureActivation.
 */

import { getLogger } from "../utils/Logger.ts";
import type { WasmCompiledNetworkConstructor } from "./WasmCompiledNetwork.ts";

// deno-lint-ignore no-explicit-any
type WasmModule = any;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let wasmModule: WasmModule | null = null;
let compiledNetworkClass: WasmCompiledNetworkConstructor | null = null;
let initPromise: Promise<boolean> | null = null;

// Standalone function pointers
let squashFn: ((squashType: number, value: number) => number) | null = null;
let derivativeFn: ((squashType: number, value: number) => number) | null = null;
let unsquashFn:
  | ((squashType: number, activation: number, hint: number) => number)
  | null = null;
let safeZoneAdjustmentFn:
  | ((
    squashType: number,
    rawInput: number,
    error: number,
    weight: number,
  ) => number)
  | null = null;
let safeZoneAdjustmentBatchFn:
  | ((
    squashTypes: Uint8Array,
    rawInputs: Float32Array,
    error: number,
    weights: Float32Array,
  ) => Float32Array)
  | null = null;
let calculateErrorFn:
  | ((
    squashType: number,
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ) => number)
  | null = null;
let mseSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let maeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let crossEntropySumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let mapeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let msleSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let hingeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let fusedErrorDistributionFn:
  | ((
    neuronSquashType: number,
    neuronActivation: number,
    neuronTargetActivation: number,
    neuronHintValue: number,
    upstreamSquashTypes: Uint8Array,
    upstreamHintValues: Float32Array,
    upstreamActivations: Float32Array,
    synapseWeights: Float32Array,
  ) => Float32Array)
  | null = null;
let getRangeFn: ((squashType: number) => Float32Array) | null = null;
let validateRangeFn:
  | ((squashType: number, activation: number) => boolean)
  | null = null;
let limitRangeFn: ((squashType: number, value: number) => number) | null = null;
let versionFn: (() => string) | null = null;

// Issue #1954 - Topological backpropagation loop
let propagateTopologicalFn:
  | ((data: Uint8Array) => Float64Array)
  | null = null;

// Issue #1959 - Selective WASM residency for read-heavy topology operations
let validateTopologyFn:
  | ((fromIndices: Uint32Array, toIndices: Uint32Array) => Int32Array)
  | null = null;
let scanAvailableConnectionsFn:
  | ((
    fromIndices: Uint32Array,
    toIndices: Uint32Array,
    isConstant: Uint8Array,
    numNeurons: number,
    numInputs: number,
  ) => Uint32Array)
  | null = null;
let computeReverseTopologicalOrderFn:
  | ((
    fromIndices: Uint32Array,
    toIndices: Uint32Array,
    numNeurons: number,
    numInputs: number,
  ) => Uint32Array)
  | null = null;

// Issue #1961 - Structural integrity validation and cycle detection
let validateStructuralIntegrityFn:
  | ((
    fromIndices: Uint32Array,
    toIndices: Uint32Array,
    isConstant: Uint8Array,
    squashTypes: Uint8Array,
    biases: Float64Array,
    numInputs: number,
    numOutputs: number,
    synapseTypes: Uint8Array,
  ) => Int32Array)
  | null = null;
let detectCyclesFn:
  | ((
    fromIndices: Uint32Array,
    toIndices: Uint32Array,
    numNeurons: number,
    numInputs: number,
  ) => number)
  | null = null;

// Issue #1519 - Standalone elastic error distribution
let distributeElasticErrorFn:
  | ((
    error: number,
    activations: Float32Array,
    safeZoneFactors: Float32Array,
    weights: Float32Array,
    plankConstant: number,
  ) => Float32Array)
  | null = null;

// Issue #1518 - Accumulation function pointers
let accumulateWeightBatch4WayFn:
  | ((
    currentWeights: Float64Array,
    targetValues: Float64Array,
    activations: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
  ) => Float64Array)
  | null = null;
let accumulateWeightBatch8WayFn:
  | ((
    currentWeights: Float64Array,
    targetValues: Float64Array,
    activations: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
  ) => Float64Array)
  | null = null;
let accumulateBiasBatch4WayFn:
  | ((
    targetPreActivations: Float64Array,
    preActivations: Float64Array,
    currentBiases: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
  ) => Float64Array)
  | null = null;
let accumulateBiasBatch8WayFn:
  | ((
    targetPreActivations: Float64Array,
    preActivations: Float64Array,
    currentBiases: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
  ) => Float64Array)
  | null = null;
let calculateWeightWasmFn:
  | ((
    count: number,
    totalPositiveActivation: number,
    totalNegativeActivation: number,
    countPositive: number,
    countNegative: number,
    totalPositiveAdjustedValue: number,
    totalNegativeAdjustedValue: number,
    currentWeight: number,
    generations: number,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
    l1WeightDecay: number,
    l2WeightDecay: number,
  ) => number)
  | null = null;
let calculateBiasWasmFn:
  | ((
    count: number,
    totalAdjustedBias: number,
    currentBias: number,
    noChange: boolean,
    generations: number,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
    l1BiasDecay: number,
    l2BiasDecay: number,
  ) => number)
  | null = null;

// Issue #1522 - Persistent training state function pointers
let initTrainingStateFn:
  | ((numSynapses: number, numNeurons: number) => void)
  | null = null;
let resetTrainingStateFn: (() => void) | null = null;
let freeTrainingStateFn: (() => void) | null = null;
let readSynapseStateFn:
  | ((index: number) => Float64Array)
  | null = null;
let readNeuronStateFn:
  | ((index: number) => Float64Array)
  | null = null;
let readAllSynapseStateFn: (() => Float64Array) | null = null;
let readAllNeuronStateFn: (() => Float64Array) | null = null;
let accumulateWeightPersistent4WayFn:
  | ((
    startIndex: number,
    currentWeights: Float64Array,
    targetValues: Float64Array,
    activations: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
  ) => void)
  | null = null;
let accumulateWeightPersistent8WayFn:
  | ((
    startIndex: number,
    currentWeights: Float64Array,
    targetValues: Float64Array,
    activations: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
  ) => void)
  | null = null;
let accumulateBiasPersistent4WayFn:
  | ((
    startIndex: number,
    targetPreActivations: Float64Array,
    preActivations: Float64Array,
    currentBiases: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
  ) => void)
  | null = null;
let accumulateBiasPersistent8WayFn:
  | ((
    startIndex: number,
    targetPreActivations: Float64Array,
    preActivations: Float64Array,
    currentBiases: Float64Array,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
  ) => void)
  | null = null;

// Issue #1960 - Batch calculate weight/bias function pointers
let calculateWeightBatch4WayFn:
  | ((
    packedState: Float64Array,
    generations: number,
    plankConstant: number,
    learningRate: number,
    maxWeightAdjScale: number,
    limitWeightScale: number,
    l1WeightDecay: number,
    l2WeightDecay: number,
  ) => Float64Array)
  | null = null;
let calculateBiasBatch4WayFn:
  | ((
    packedState: Float64Array,
    noChangeFlags: Uint8Array,
    generations: number,
    plankConstant: number,
    learningRate: number,
    maxBiasAdjScale: number,
    limitBiasScale: number,
    l1BiasDecay: number,
    l2BiasDecay: number,
  ) => Float64Array)
  | null = null;

// Issue #1960 - Batch topology validation function pointer
let validateTopologyBatchFn:
  | ((
    allFromIndices: Uint32Array,
    allToIndices: Uint32Array,
    lengths: Uint32Array,
  ) => Int32Array)
  | null = null;

// Issue #1521 - Score scan function pointers
let computeScoreComponentsFn:
  | ((weights: Float64Array, biases: Float64Array) => Float64Array)
  | null = null;
let scanMaxWeightFn:
  | ((
    weights: Float64Array,
    biases: Float64Array,
    excludeIdx: number,
    newWeight: number,
  ) => Float64Array)
  | null = null;
let scanMaxBiasFn:
  | ((
    weights: Float64Array,
    biases: Float64Array,
    excludeIdx: number,
    newBias: number,
  ) => Float64Array)
  | null = null;

// ---------------------------------------------------------------------------
// Helpers to populate function pointers from a module
// ---------------------------------------------------------------------------

function assignFunctionPointers(module: WasmModule): void {
  wasmModule = module;
  compiledNetworkClass = module.CompiledNetwork;
  squashFn = module.squash;
  derivativeFn = module.derivative;
  unsquashFn = module.unsquash;
  safeZoneAdjustmentFn = module.safe_zone_adjustment;
  safeZoneAdjustmentBatchFn = module.safe_zone_adjustment_batch;
  calculateErrorFn = module.calculate_error;
  fusedErrorDistributionFn = module.fused_error_distribution;
  mseSumBatchPackedFn = module.mse_sum_batch_packed;
  maeSumBatchPackedFn = module.mae_sum_batch_packed;
  crossEntropySumBatchPackedFn = module.cross_entropy_sum_batch_packed;
  mapeSumBatchPackedFn = module.mape_sum_batch_packed;
  msleSumBatchPackedFn = module.msle_sum_batch_packed;
  hingeSumBatchPackedFn = module.hinge_sum_batch_packed;
  getRangeFn = module.get_range;
  validateRangeFn = module.validate_range;
  limitRangeFn = module.limit_range;
  versionFn = module.version;
  // Issue #1954 - Topological backpropagation loop
  propagateTopologicalFn = module.propagate_topological;
  // Issue #1959 - Selective WASM residency for read-heavy topology operations
  validateTopologyFn = module.validate_topology;
  scanAvailableConnectionsFn = module.scan_available_connections;
  computeReverseTopologicalOrderFn = module.compute_reverse_topological_order;
  // Issue #1961 - Structural integrity validation and cycle detection
  validateStructuralIntegrityFn = module.validate_structural_integrity;
  detectCyclesFn = module.detect_cycles;
  // Issue #1519 - Standalone elastic error distribution
  distributeElasticErrorFn = module.distribute_elastic_error;
  // Issue #1518 - Accumulation functions
  accumulateWeightBatch4WayFn = module.accumulate_weight_batch_4way;
  accumulateWeightBatch8WayFn = module.accumulate_weight_batch_8way;
  accumulateBiasBatch4WayFn = module.accumulate_bias_batch_4way;
  accumulateBiasBatch8WayFn = module.accumulate_bias_batch_8way;
  calculateWeightWasmFn = module.calculate_weight;
  calculateBiasWasmFn = module.calculate_bias;
  // Issue #1522 - Persistent training state functions
  initTrainingStateFn = module.init_training_state;
  resetTrainingStateFn = module.reset_training_state;
  freeTrainingStateFn = module.free_training_state;
  readSynapseStateFn = module.read_synapse_state;
  readNeuronStateFn = module.read_neuron_state;
  readAllSynapseStateFn = module.read_all_synapse_state;
  readAllNeuronStateFn = module.read_all_neuron_state;
  accumulateWeightPersistent4WayFn = module.accumulate_weight_persistent_4way;
  accumulateWeightPersistent8WayFn = module.accumulate_weight_persistent_8way;
  accumulateBiasPersistent4WayFn = module.accumulate_bias_persistent_4way;
  accumulateBiasPersistent8WayFn = module.accumulate_bias_persistent_8way;
  // Issue #1960 - Batch calculate weight/bias and topology validation
  calculateWeightBatch4WayFn = module.calculate_weight_batch_4way;
  calculateBiasBatch4WayFn = module.calculate_bias_batch_4way;
  validateTopologyBatchFn = module.validate_topology_batch;
  // Issue #1521 - Score scan functions
  computeScoreComponentsFn = module.compute_score_components;
  scanMaxWeightFn = module.scan_max_weight;
  scanMaxBiasFn = module.scan_max_bias;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and initialise the WASM module. Internal implementation detail (Issue #1256).
 * Callers do not call this; the library initialises the backend automatically.
 */
export async function initWasmActivation(): Promise<boolean> {
  if (wasmModule !== null) {
    return true;
  }

  if (initPromise) {
    return await initPromise;
  }

  initPromise = (async () => {
    try {
      const modulePath =
        new URL("../../wasm_activation/pkg/wasm_activation.js", import.meta.url)
          .href;
      const module = await import(modulePath);
      await module.default();
      assignFunctionPointers(module);
      return true;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const msg = (error as Error)?.message ?? String(error);
      const isNotFound = code === "ERR_MODULE_NOT_FOUND" ||
        /module not found/i.test(msg);
      if (isNotFound) {
        getLogger().warn(
          "WASM activation: pkg not found at the canonical package location.",
        );
      } else {
        getLogger().error(
          "Failed to initialise WASM activation module:",
          error,
        );
      }
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return await initPromise;
}

/**
 * Load and initialise the WASM module synchronously from binary data.
 * Internal implementation detail (Issue #1256).
 *
 * @param jsBindings - The JS bindings module
 * @param wasmBinary - The WASM binary data
 */
export function initWasmActivationSync(
  jsBindings: WasmModule,
  wasmBinary: Uint8Array,
): boolean {
  if (wasmModule !== null) {
    return true;
  }

  if (initPromise) {
    getLogger().error(
      "Failed to initialise WASM activation module sync: async init in progress",
    );
    return false;
  }

  try {
    try {
      jsBindings.initSync({ module: wasmBinary });
    } catch {
      jsBindings.initSync(wasmBinary);
    }
    assignFunctionPointers(jsBindings);
    return true;
  } catch (error) {
    getLogger().error(
      "Failed to initialise WASM activation module sync:",
      error,
    );
    return false;
  }
}

/**
 * Check if WASM activation is available.
 */
export function isWasmActivationAvailable(): boolean {
  return wasmModule !== null && compiledNetworkClass !== null;
}

// ---------------------------------------------------------------------------
// Function pointer getters (used by WasmStandaloneFunctions and WasmCreatureActivation)
// ---------------------------------------------------------------------------

export function getCompiledNetworkClass():
  | WasmCompiledNetworkConstructor
  | null {
  return compiledNetworkClass;
}

export function getSquashFn(): typeof squashFn {
  return squashFn;
}

export function getDerivativeFn(): typeof derivativeFn {
  return derivativeFn;
}

export function getUnsquashFn(): typeof unsquashFn {
  return unsquashFn;
}

export function getSafeZoneAdjustmentFn(): typeof safeZoneAdjustmentFn {
  return safeZoneAdjustmentFn;
}

export function getSafeZoneAdjustmentBatchFn(): typeof safeZoneAdjustmentBatchFn {
  return safeZoneAdjustmentBatchFn;
}

export function getCalculateErrorFn(): typeof calculateErrorFn {
  return calculateErrorFn;
}

export function getMseSumBatchPackedFn(): typeof mseSumBatchPackedFn {
  return mseSumBatchPackedFn;
}

export function getMaeSumBatchPackedFn(): typeof maeSumBatchPackedFn {
  return maeSumBatchPackedFn;
}

export function getCrossEntropySumBatchPackedFn(): typeof crossEntropySumBatchPackedFn {
  return crossEntropySumBatchPackedFn;
}

export function getMapeSumBatchPackedFn(): typeof mapeSumBatchPackedFn {
  return mapeSumBatchPackedFn;
}

export function getMsleSumBatchPackedFn(): typeof msleSumBatchPackedFn {
  return msleSumBatchPackedFn;
}

export function getHingeSumBatchPackedFn(): typeof hingeSumBatchPackedFn {
  return hingeSumBatchPackedFn;
}

export function getFusedErrorDistributionFn(): typeof fusedErrorDistributionFn {
  return fusedErrorDistributionFn;
}

export function getGetRangeFn(): typeof getRangeFn {
  return getRangeFn;
}

export function getValidateRangeFn(): typeof validateRangeFn {
  return validateRangeFn;
}

export function getLimitRangeFn(): typeof limitRangeFn {
  return limitRangeFn;
}

export function getVersionFn(): typeof versionFn {
  return versionFn;
}

// Issue #1519 - Elastic error distribution getter
export function getDistributeElasticErrorFn(): typeof distributeElasticErrorFn {
  return distributeElasticErrorFn;
}

// Issue #1518 - Accumulation function pointer getters
export function getAccumulateWeightBatch4WayFn(): typeof accumulateWeightBatch4WayFn {
  return accumulateWeightBatch4WayFn;
}

export function getAccumulateWeightBatch8WayFn(): typeof accumulateWeightBatch8WayFn {
  return accumulateWeightBatch8WayFn;
}

export function getAccumulateBiasBatch4WayFn(): typeof accumulateBiasBatch4WayFn {
  return accumulateBiasBatch4WayFn;
}

export function getAccumulateBiasBatch8WayFn(): typeof accumulateBiasBatch8WayFn {
  return accumulateBiasBatch8WayFn;
}

export function getCalculateWeightWasmFn(): typeof calculateWeightWasmFn {
  return calculateWeightWasmFn;
}

export function getCalculateBiasWasmFn(): typeof calculateBiasWasmFn {
  return calculateBiasWasmFn;
}

// Issue #1522 - Persistent training state function pointer getters
export function getInitTrainingStateFn(): typeof initTrainingStateFn {
  return initTrainingStateFn;
}

export function getResetTrainingStateFn(): typeof resetTrainingStateFn {
  return resetTrainingStateFn;
}

export function getFreeTrainingStateFn(): typeof freeTrainingStateFn {
  return freeTrainingStateFn;
}

export function getReadSynapseStateFn(): typeof readSynapseStateFn {
  return readSynapseStateFn;
}

export function getReadNeuronStateFn(): typeof readNeuronStateFn {
  return readNeuronStateFn;
}

export function getReadAllSynapseStateFn(): typeof readAllSynapseStateFn {
  return readAllSynapseStateFn;
}

export function getReadAllNeuronStateFn(): typeof readAllNeuronStateFn {
  return readAllNeuronStateFn;
}

export function getAccumulateWeightPersistent4WayFn(): typeof accumulateWeightPersistent4WayFn {
  return accumulateWeightPersistent4WayFn;
}

export function getAccumulateWeightPersistent8WayFn(): typeof accumulateWeightPersistent8WayFn {
  return accumulateWeightPersistent8WayFn;
}

export function getAccumulateBiasPersistent4WayFn(): typeof accumulateBiasPersistent4WayFn {
  return accumulateBiasPersistent4WayFn;
}

export function getAccumulateBiasPersistent8WayFn(): typeof accumulateBiasPersistent8WayFn {
  return accumulateBiasPersistent8WayFn;
}

// Issue #1521 - Score scan function pointer getters
export function getComputeScoreComponentsFn(): typeof computeScoreComponentsFn {
  return computeScoreComponentsFn;
}

export function getScanMaxWeightFn(): typeof scanMaxWeightFn {
  return scanMaxWeightFn;
}

export function getScanMaxBiasFn(): typeof scanMaxBiasFn {
  return scanMaxBiasFn;
}

// Issue #1954 - Topological backpropagation getter
export function getPropagateTopologicalFn(): typeof propagateTopologicalFn {
  return propagateTopologicalFn;
}

// Issue #1959 - Topology operation getters
export function getValidateTopologyFn(): typeof validateTopologyFn {
  return validateTopologyFn;
}

export function getScanAvailableConnectionsFn(): typeof scanAvailableConnectionsFn {
  return scanAvailableConnectionsFn;
}

export function getComputeReverseTopologicalOrderFn(): typeof computeReverseTopologicalOrderFn {
  return computeReverseTopologicalOrderFn;
}

// Issue #1961 - Structural integrity and cycle detection getters
export function getValidateStructuralIntegrityFn(): typeof validateStructuralIntegrityFn {
  return validateStructuralIntegrityFn;
}

export function getDetectCyclesFn(): typeof detectCyclesFn {
  return detectCyclesFn;
}

// Issue #1960 - Batch operation function pointer getters
export function getCalculateWeightBatch4WayFn(): typeof calculateWeightBatch4WayFn {
  return calculateWeightBatch4WayFn;
}

export function getCalculateBiasBatch4WayFn(): typeof calculateBiasBatch4WayFn {
  return calculateBiasBatch4WayFn;
}

export function getValidateTopologyBatchFn(): typeof validateTopologyBatchFn {
  return validateTopologyBatchFn;
}
