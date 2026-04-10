/**
 * Configuration for parallel batch creature evaluation.
 *
 * Issue #1862: Controls how creatures are distributed across workers
 * during population fitness assessment. Topology-aware grouping ensures
 * creatures with identical network structure are evaluated on the same
 * worker, maximising WASM compilation cache hits.
 *
 * When `topologyGrouping` is enabled, the evaluation queue is sorted
 * by topology hash so same-topology creatures cluster together and
 * naturally flow to the same worker via the work-stealing pattern.
 *
 * `maxConcurrentEvaluations` allows capping the number of workers
 * used for evaluation independently from the total thread count,
 * which is useful when other tasks (training, discovery) need
 * workers concurrently.
 *
 * Issue #2245: The `busyWorkerWaitMs` option was removed because fitness
 * evaluation now receives only fast-pool workers that are dedicated to
 * evaluation and never run discovery or training. The reactive
 * `isRunningLongTask()` filtering is no longer needed.
 */

/**
 * Configuration for parallel batch creature evaluation.
 *
 * All fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface ParallelEvaluationConfig {
  /**
   * Maximum number of concurrent creature evaluations.
   *
   * Caps how many workers participate in fitness evaluation.
   * When 0 (default), all available workers are used.
   *
   * Useful when other tasks (training, discovery) need workers
   * concurrently and you want to reserve capacity for them.
   */
  maxConcurrentEvaluations?: number;

  /**
   * Whether to group creatures by topology hash before evaluation.
   *
   * When enabled, creatures with identical network topology are
   * adjacent in the evaluation queue. This improves WASM compilation
   * cache hit rates because same-topology creatures naturally flow
   * to the same worker via the work-stealing pattern.
   *
   * Defaults to true.
   */
  topologyGrouping?: boolean;
}

/**
 * Required version of ParallelEvaluationConfig with all fields populated.
 */
export type RequiredParallelEvaluationConfig = Required<
  ParallelEvaluationConfig
>;

/**
 * Default values for parallel evaluation configuration.
 *
 * `maxConcurrentEvaluations` defaults to 0 (use all workers).
 * `topologyGrouping` defaults to true for optimal WASM cache utilisation.
 */
export const DEFAULT_PARALLEL_EVALUATION_CONFIG:
  RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 0,
    topologyGrouping: true,
  };
