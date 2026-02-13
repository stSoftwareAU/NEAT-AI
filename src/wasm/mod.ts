/**
 * WASM Activation module exports for NEAT-AI
 *
 * Issue #1116 - WASM prototype for creature activation
 * Issue #1143 - WASM Migration Phase 11: Integrate WASM activation methods into backpropagation
 * Issue #1256 - initWasmActivation / initWasmActivationSync are internal implementation details;
 * the public API (mod.ts) does not export them. Callers use Creature.activate() etc.; the library
 * initialises the backend automatically.
 * Issue #1405 - Facade refactoring: WasmActivation.ts split into WasmModuleLoader.ts,
 * WasmStandaloneFunctions.ts, WasmAutoInit.ts, and WasmActivation.ts (class only).
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

// Issue #1405 - Module loading, init, and availability from WasmModuleLoader
export {
  initWasmActivation,
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "./WasmModuleLoader.ts";

// Issue #1405 - Standalone WASM functions from WasmStandaloneFunctions
export {
  type FusedErrorDistributionResult,
  type WasmActivationRange,
  wasmCalculateError,
  wasmDerivative,
  wasmFusedErrorDistribution,
  wasmGetRange,
  wasmLimitRange,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
  wasmSquash,
  wasmUnSquash,
  wasmValidateRange,
  wasmVersion,
} from "./WasmStandaloneFunctions.ts";

// Issue #1405 - WasmCreatureActivation class and trace types from WasmActivation
export {
  WasmCreatureActivation,
  type WasmTraceEntry,
  type WasmTraceResult,
} from "./WasmActivation.ts";

// Issue #1405 - Auto-init and worker scope detection from WasmAutoInit
export { isProbablyWorkerScope } from "./WasmAutoInit.ts";

// Issue #1247 - Shared WASM activation initialisation helper
export { ensureWasmActivation } from "./EnsureWasmActivation.ts";

// Issue #1143 - Unified wrapper functions for WASM/JS activation methods
// Issue #1241 - Removed shouldUseWasmBackprop/resetWasmBackpropFlag (WASM is unconditional)
export {
  calculateError,
  fusedErrorDistribution,
  isWasmSquashSupported,
  safeZoneAdjustment,
  safeZoneAdjustmentBatch,
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
