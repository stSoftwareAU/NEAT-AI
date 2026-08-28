/**
 * @module
 *
 * The failure a worker task is settled with when its response can never
 * arrive (GRQ #4489).
 *
 * A request posted to a worker used to have exactly two outcomes: a response,
 * or nothing at all. "Nothing at all" is what a wedged isolate produces — the
 * task promise stayed pending for the rest of the run, the worker slot stayed
 * held, and the only trace was NEAT's stuck-task watchdog forgetting the
 * bookkeeping. This error is the third outcome: a loud, attributed failure
 * naming the task, the worker, how long it ran and why it was given up on.
 */

/** Details describing why a worker task was cancelled. */
export interface WorkerTaskCancellation {
  /** The worker-protocol task id that was cancelled. */
  taskID: number;
  /** The handler that owned the task. */
  workerID: number;
  /** Milliseconds between dispatch and cancellation. */
  elapsedMs: number;
  /** Operator-facing reason, e.g. the deadline that was missed. */
  reason: string;
  /** The underlying fault, when one was observed (e.g. a worker crash). */
  cause?: Error;
}

/**
 * Thrown into a worker task's promise when the task is given up on: it passed
 * its deadline without a response, its worker crashed, or its worker was
 * quarantined.
 */
export class WorkerTaskCancelledError extends Error {
  /** The worker-protocol task id that was cancelled. */
  readonly taskID: number;
  /** The handler that owned the task. */
  readonly workerID: number;
  /** Milliseconds between dispatch and cancellation. */
  readonly elapsedMs: number;
  /** Operator-facing reason the task was given up on. */
  readonly reason: string;

  constructor(details: WorkerTaskCancellation) {
    super(
      `Worker task ${details.taskID} on worker-${details.workerID} was ` +
        `cancelled after ${details.elapsedMs}ms without a response: ` +
        `${details.reason}` +
        (details.cause ? ` (cause: ${details.cause.message})` : "") +
        ` (GRQ #4489)`,
      details.cause ? { cause: details.cause } : undefined,
    );
    this.name = "WorkerTaskCancelledError";
    this.taskID = details.taskID;
    this.workerID = details.workerID;
    this.elapsedMs = details.elapsedMs;
    this.reason = details.reason;
  }
}
