/**
 * Configuration for capping worker thread count based on available memory.
 *
 * Issue #1569: On memory-constrained machines, spawning one worker per CPU
 * core can exhaust RAM. This config allows an opt-in memory budget so that
 * the effective thread count is capped to fit within the available memory.
 *
 * When `maxMemoryMB` is set, the effective thread count is:
 *   min(threads, floor(maxMemoryMB / estimatedMemoryPerWorkerMB))
 *
 * When `maxMemoryMB` is not set, behaviour is unchanged (no cap applied).
 */

/**
 * Configuration for memory-based worker thread capping.
 *
 * All fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface WorkerThreadCapConfig {
  /**
   * Maximum total memory budget in megabytes for worker threads.
   *
   * When provided, the worker thread count is capped so that
   * `threads * estimatedMemoryPerWorkerMB <= maxMemoryMB`.
   *
   * When omitted, no memory-based capping is applied (opt-in behaviour).
   */
  maxMemoryMB?: number;

  /**
   * Estimated memory consumption per worker thread in megabytes.
   *
   * Used to calculate the maximum safe number of workers:
   *   `floor(maxMemoryMB / estimatedMemoryPerWorkerMB)`
   *
   * Defaults to 2048 MB (2 GB), which is a sensible estimate for
   * GRQ-scale training workloads.
   */
  estimatedMemoryPerWorkerMB?: number;
}

/**
 * Required version of WorkerThreadCapConfig with all fields populated.
 */
export type RequiredWorkerThreadCapConfig = Required<WorkerThreadCapConfig>;

/**
 * Default values for worker thread cap configuration.
 *
 * Note: `maxMemoryMB` defaults to 0 (disabled). When 0, no memory-based
 * capping is applied. `estimatedMemoryPerWorkerMB` defaults to 2048 MB.
 */
export const DEFAULT_WORKER_THREAD_CAP_CONFIG: RequiredWorkerThreadCapConfig = {
  maxMemoryMB: 0,
  estimatedMemoryPerWorkerMB: 2048,
};
