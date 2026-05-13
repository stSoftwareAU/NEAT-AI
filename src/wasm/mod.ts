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
} from "@wasm/CompileToWasm.ts";

export {
  getSquashType,
  resolveWasmSquashName,
  SQUASH_NAME_TO_TYPE,
  SquashType,
} from "@wasm/SquashType.ts";

// Issue #1405 - Module loading, init, and availability from WasmModuleLoader
export {
  initWasmActivation,
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "@wasm/WasmModuleLoader.ts";

// Issue #1405 - Standalone WASM functions from WasmStandaloneFunctions
export {
  type FusedErrorDistributionResult,
  wasmAccumulateBiasBatch4Way,
  wasmAccumulateBiasBatch8Way,
  wasmAccumulateWeightBatch4Way,
  wasmAccumulateWeightBatch8Way,
  type WasmActivationRange,
  wasmCalculateBias,
  wasmCalculateError,
  wasmCalculateWeight,
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
} from "@wasm/WasmStandaloneFunctions.ts";

// Issue #1475 - Typed interface for WASM compiled network
export type {
  WasmCompiledNetwork,
  WasmCompiledNetworkConstructor,
} from "@wasm/WasmCompiledNetwork.ts";

// Issue #1405 - WasmCreatureActivation class and trace types from WasmActivation
export {
  WasmCreatureActivation,
  type WasmTraceEntry,
  type WasmTraceResult,
} from "@wasm/WasmActivation.ts";

// Issue #1405 - Auto-init and worker scope detection from WasmAutoInit
export { isProbablyWorkerScope } from "@wasm/WasmAutoInit.ts";

// Issue #1247 - Shared WASM activation initialisation helper
export { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

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
} from "@wasm/ActivationMethods.ts";

// Issue #1301 - WASM compilation caching for creatures with identical topologies
// Issue #2287 - Pre-warm cache support (ensureWasmTemplate, hasWasmTemplate)
// Issue #2483 - Deduped logging for failed WASM compiles
export {
  clearWasmCompilationCache,
  ensureWasmTemplate,
  getOrCompileWasmModule,
  getWasmCompilationCacheMaxSize,
  getWasmCompilationCacheStats,
  hasWasmTemplate,
  invalidateWasmCache,
  resetFailedCompileDedup,
  setWasmCompilationCacheSize,
  type WasmCacheStats,
} from "@wasm/WasmCompilationCache.ts";

// Issue #2483 - Last-failure introspection for WasmCreatureActivation.create
export {
  getLastWasmCreateFailure,
  resetLastWasmCreateFailure,
} from "@wasm/WasmActivation.ts";

// Issue #1522 - Persistent training state in WASM linear memory
export {
  bulkUnpackNeuronState,
  bulkUnpackSynapseState,
  freeTrainingState,
  initTrainingState,
  readAllNeuronState,
  readAllSynapseState,
  readNeuronState,
  readSynapseState,
  resetTrainingState,
  unpackNeuronState,
  unpackSynapseState,
  wasmAccumulateBiasPersistent4Way,
  wasmAccumulateBiasPersistent8Way,
  wasmAccumulateWeightPersistent4Way,
  wasmAccumulateWeightPersistent8Way,
} from "@wasm/WasmTrainingState.ts";

// Issue #1960 - Batch APIs for amortising WASM boundary crossing
export {
  calculateBiasBatch4Way,
  calculateWeightBatch4Way,
  validateTopologyBatch,
} from "@wasm/WasmBatchOps.ts";

// Issue #1338 - Bound cached WASM activations under memory pressure
// Issue #1504 - Added getCachedWasmActivationCount for cache diagnostics
// Issue #1616 - Added getWasmActivationLruStats and resetWasmActivationLruStats
export {
  disposeAllCachedWasmActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  getWasmActivationLruStats,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";

// Issue #2287 - Pre-warm WASM compilation cache before fitness evaluation
export {
  type PreWarmResult,
  preWarmWasmCache,
} from "@wasm/WasmCachePreWarmer.ts";

// Issue #2417 - Topology DOT/JSON export delegating to NEAT-AI-core
export {
  exportTopologyDot,
  exportTopologyJson,
  type TopologyExportJson,
  type TopologyExportNode,
  type TopologyExportSynapse,
} from "@wasm/WasmTopologyExport.ts";

// Issue #2636 - Producer-side compile gate (mutate/breed reject bad topologies)
export {
  ensureProducerOutputCompiles,
  type ProducerCompileResult,
} from "@wasm/ProducerCompileGuard.ts";

// Issue #2643 - Serialiser self-consistency check for the WASM binary format
export { assertWasmBinaryWellFormed } from "@wasm/WasmBinaryValidator.ts";
