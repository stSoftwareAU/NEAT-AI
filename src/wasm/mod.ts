/**
 * WASM Activation module exports for NEAT-AI
 *
 * Issue #1116 - WASM prototype for creature activation
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 */

export {
  compileCreatureToWasm,
  type CompiledCreatureData,
  getCompiledCreatureStats,
} from "./CompileToWasm.ts";

export {
  getSquashType,
  resolveWasmSquashName,
  SQUASH_NAME_TO_TYPE,
  SquashType,
} from "./SquashType.ts";

export {
  initWasmActivation,
  initWasmActivationSync,
  isWasmActivationAvailable,
  type WasmActivationRange,
  wasmCalculateError,
  WasmCreatureActivation,
  wasmDerivative,
  wasmGetRange,
  wasmLimitRange,
  wasmSafeZoneAdjustment,
  wasmSquash,
  type WasmTraceEntry,
  type WasmTraceResult,
  wasmUnSquash,
  wasmValidateRange,
  wasmVersion,
} from "./WasmActivation.ts";

// Issue #1143 - Unified wrapper functions for WASM/JS activation methods
export {
  calculateError,
  isWasmSquashSupported,
  resetWasmBackpropFlag,
  safeZoneAdjustment,
  shouldUseWasmBackprop,
  squash,
  unSquash,
} from "./ActivationMethods.ts";
