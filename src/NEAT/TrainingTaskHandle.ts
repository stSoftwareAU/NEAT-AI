/**
 * @module
 *
 * The worker request behind an in-flight training task (GRQ #4489).
 *
 * NEAT's stuck-task watchdog could only forget its own bookkeeping: the worker
 * request it had given up on stayed in flight, unsettled, for the rest of the
 * run. Recording the worker and the task id makes the work cancellable, which
 * is what turns "the task never came back" into a reported failure.
 */

/**
 * The slice of a worker handler the watchdog needs in order to give up on a
 * task. Kept narrow so the scheduler is not coupled to the whole handler.
 */
export interface CancellableWorker {
  /**
   * Give up on one in-flight task, settling its promise as a failure.
   *
   * @returns true when a pending task was cancelled
   */
  cancelTask(taskID: number, reason: string, cause?: Error): boolean;

  /** Take the worker out of service — it must not be given new work. */
  quarantine(reason: string, cause?: Error): void;
}

/** A dispatched training task, addressable for cancellation. */
export interface TrainingTaskHandle {
  /** The worker running the task. */
  readonly worker: CancellableWorker;
  /** The worker-protocol task id of the request. */
  readonly taskID: number;
}
