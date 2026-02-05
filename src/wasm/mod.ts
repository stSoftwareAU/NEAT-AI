/**
 * WASM Activation module exports for NEAT-AI
 *
 * Issue #1116 - WASM prototype for creature activation
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 * Issue #1256 - initWasmActivation / initWasmActivationSync are internal implementation details;
 * the public API (mod.ts) does not export them. Callers use Creature.activate() etc.; the library
 * initialises the backend automatically.
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
  isProbablyWorkerScope,
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

// Issue #1247 - Shared WASM activation initialisation helper
export { ensureWasmActivation } from "./EnsureWasmActivation.ts";

// Issue #1143 - Unified wrapper functions for WASM/JS activation methods
// Issue #1241 - Removed shouldUseWasmBackprop/resetWasmBackpropFlag (WASM is unconditional)
export {
  calculateError,
  isWasmSquashSupported,
  safeZoneAdjustment,
  squash,
  unSquash,
} from "./ActivationMethods.ts";

// Issue #1301 - WASM compilation caching for creatures with identical topologies
export {
  clearWasmCompilationCache,
  getOrCompileWasmModule,
  getWasmCompilationCacheMaxSize,
  getWasmCompilationCacheStats,
  invalidateWasmCache,
  setWasmCompilationCacheSize,
  type WasmCacheStats,
} from "./WasmCompilationCache.ts";

// Issue #1338 - Bound cached WASM activations under memory pressure
export {
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "./WasmCreatureActivationLRU.ts";
