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
