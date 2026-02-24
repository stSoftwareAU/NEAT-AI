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
} from "./WorkerInterface.ts";
export { getInitTimeoutMs, WorkerHandlerBase } from "./WorkerHandlerBase.ts";
export type { WasmActivationInitPayload } from "./WasmActivationPayload.ts";
export {
  fetchWasmForWorkers,
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "./WasmActivationPayload.ts";
export { initialiseWasmActivationFromPayload } from "./WasmWorkerInit.ts";
export { setupWorkerMessageLoop } from "./workerEntryPoint.ts";
