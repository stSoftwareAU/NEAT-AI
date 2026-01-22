/**
 * WASM Activation module exports for NEAT-AI
 *
 * Issue #1116 - WASM prototype for creature activation
 */

export {
  compileCreatureToWasm,
  type CompiledCreatureData,
  getCompiledCreatureStats,
} from "./CompileToWasm.ts";

export {
  getSquashType,
  SQUASH_NAME_TO_TYPE,
  SquashType,
} from "./SquashType.ts";

export {
  initWasmActivation,
  initWasmActivationSync,
  isWasmActivationAvailable,
  wasmCalculateError,
  WasmCreatureActivation,
  wasmDerivative,
  wasmSafeZoneAdjustment,
  wasmSquash,
  type WasmTraceEntry,
  type WasmTraceResult,
  wasmUnSquash,
  wasmVersion,
} from "./WasmActivation.ts";
