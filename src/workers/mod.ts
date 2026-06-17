/**
 * Shared worker infrastructure module.
 *
 * Provides the base classes, types, and utilities used by both
 * the multithreading and intelligentDesign worker systems.
 *
 * Issue #1600: Single source of truth for worker lifecycle management.
 *
 * @module
 */

export type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
export {
  getInitTimeoutMs,
  WorkerHandlerBase,
} from "@workers/WorkerHandlerBase.ts";
export type { WasmActivationInitPayload } from "@workers/WasmActivationPayload.ts";
export {
  fetchWasmForWorkers,
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";
export { initialiseWasmActivationFromPayload } from "@workers/WasmWorkerInit.ts";
export {
  setupWorkerMessageLoop,
  verifyWorkerHeapBudget,
} from "@workers/workerEntryPoint.ts";
export type {
  EnvReader,
  WorkerHeapBudgetPlan,
} from "@workers/WorkerHeapBudget.ts";
export {
  currentHeapLimitMb,
  describeBudgetPropagation,
  DISCOVERY_HEAP_SIZE_ENV,
  planWorkerHeapBudget,
  resolveDiscoveryHeapBudgetMb,
} from "@workers/WorkerHeapBudget.ts";
