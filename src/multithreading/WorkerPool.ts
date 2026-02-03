/**
 * Issue #1290 - Work-stealing worker pool for load balancing
 *
 * A worker pool implementation that uses work-stealing queues for
 * better load distribution across workers. Each worker maintains
 * a local deque of tasks, and idle workers can "steal" tasks from
 * busy workers' queues.
 *
 * Key features:
 * - Work-stealing queues per worker
 * - Smarter worker selection based on queue size and estimated workload
 * - Statistics tracking for monitoring load balancing effectiveness
 * - Bulk steal operations for efficient rebalancing
 *
 * @example
 * ```ts
 * const pool = new WorkerPool(workers);
 *
 * // Select least-loaded worker for new task
 * const worker = pool.selectWorker();
 *
 * // Queue task to worker
 * pool.queueTask(worker, task);
 *
 * // Idle worker can steal work
 * const stolen = pool.stealWork(idleWorker);
 * ```
 */
import type { WorkerHandler } from "./workers/WorkerHandler.ts";
import { WorkStealingQueue } from "./WorkStealingQueue.ts";

/**
 * Statistics about the worker pool state.
 */
export interface WorkerPoolStats {
  /** Total number of workers in the pool */
  totalWorkers: number;
  /** Number of workers currently busy */
  busyWorkers: number;
  /** Number of workers currently idle */
  idleWorkers: number;
  /** Total number of tasks queued across all workers */
  totalQueuedTasks: number;
  /** Number of steal attempts */
  stealAttempts: number;
  /** Number of successful steals */
  successfulSteals: number;
  /** Steal success rate (0-1) */
  stealSuccessRate: number;
}

/**
 * Manages a pool of workers with work-stealing capabilities.
 *
 * This class replaces the simple random worker selection with a
 * more sophisticated approach that considers queue sizes and
 * enables work stealing for better load balancing.
 */
export class WorkerPool<T = unknown> {
  /** The workers in the pool */
  private workers: WorkerHandler[];

  /** Work-stealing queues for each worker */
  private queues: Map<WorkerHandler, WorkStealingQueue<T>> = new Map();

  /** Statistics tracking */
  private stealAttempts = 0;
  private successfulSteals = 0;

  /**
   * Creates a new worker pool.
   *
   * @param workers - Array of worker handlers to manage
   */
  constructor(workers: WorkerHandler[]) {
    this.workers = workers;

    // Initialise a work-stealing queue for each worker
    for (const worker of workers) {
      this.queues.set(worker, new WorkStealingQueue<T>());
    }
  }

  /**
   * Returns the number of workers in the pool.
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Selects the best worker for a new task.
   *
   * Selection strategy:
   * 1. If any workers are not busy, prefer them (round-robin among idle)
   * 2. If all workers are busy, select the one with the smallest queue
   *
   * This replaces the random + linear scan approach with a more
   * intelligent selection based on actual workload.
   *
   * @returns The selected worker, or undefined if no workers exist
   */
  selectWorker(): WorkerHandler | undefined {
    if (this.workers.length === 0) {
      return undefined;
    }

    // First pass: find any non-busy worker
    for (const worker of this.workers) {
      if (!worker.isBusy()) {
        return worker;
      }
    }

    // All workers are busy - select the one with smallest queue
    return this.findLeastLoadedWorker();
  }

  /**
   * Selects a worker based on estimated workload rather than task count.
   *
   * This enables smarter selection when tasks have varying durations.
   *
   * @param estimator - Function to estimate task duration
   * @returns The selected worker, or undefined if no workers exist
   */
  selectWorkerByWorkload(
    estimator: (task: T) => number,
  ): WorkerHandler | undefined {
    if (this.workers.length === 0) {
      return undefined;
    }

    // First pass: find any non-busy worker
    for (const worker of this.workers) {
      if (!worker.isBusy()) {
        return worker;
      }
    }

    // All workers are busy - select the one with lowest estimated workload
    let bestWorker: WorkerHandler | undefined;
    let lowestWorkload = Infinity;

    for (const worker of this.workers) {
      const queue = this.queues.get(worker);
      if (queue) {
        const workload = queue.getEstimatedWorkload(estimator);
        if (workload < lowestWorkload) {
          lowestWorkload = workload;
          bestWorker = worker;
        }
      }
    }

    return bestWorker ?? this.workers[0];
  }

  /**
   * Finds the worker with the smallest queue.
   *
   * @returns The least-loaded worker
   */
  private findLeastLoadedWorker(): WorkerHandler | undefined {
    let bestWorker: WorkerHandler | undefined;
    let smallestQueue = Infinity;

    for (const worker of this.workers) {
      const queue = this.queues.get(worker);
      const size = queue?.size() ?? 0;
      if (size < smallestQueue) {
        smallestQueue = size;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Finds the worker with the largest queue.
   *
   * @param exclude - Optional worker to exclude from consideration
   * @returns The busiest worker, or undefined if all queues are empty
   */
  findBusiestWorker(exclude?: WorkerHandler): WorkerHandler | undefined {
    let busiestWorker: WorkerHandler | undefined;
    let largestQueue = 0;

    for (const worker of this.workers) {
      if (worker === exclude) continue;

      const queue = this.queues.get(worker);
      const size = queue?.size() ?? 0;
      if (size > largestQueue) {
        largestQueue = size;
        busiestWorker = worker;
      }
    }

    return busiestWorker;
  }

  /**
   * Adds a task to a worker's queue.
   *
   * @param worker - The worker to queue the task to
   * @param task - The task to queue
   */
  queueTask(worker: WorkerHandler, task: T): void {
    const queue = this.queues.get(worker);
    if (queue) {
      queue.pushBack(task);
    }
  }

  /**
   * Removes and returns a task from a worker's queue.
   *
   * @param worker - The worker to dequeue from
   * @returns The next task, or undefined if the queue is empty
   */
  dequeueTask(worker: WorkerHandler): T | undefined {
    const queue = this.queues.get(worker);
    return queue?.popFront();
  }

  /**
   * Gets the number of tasks in a worker's queue.
   *
   * @param worker - The worker to check
   * @returns The queue size
   */
  getQueueSize(worker: WorkerHandler): number {
    const queue = this.queues.get(worker);
    return queue?.size() ?? 0;
  }

  /**
   * Gets the total number of tasks queued across all workers.
   *
   * @returns Total queued task count
   */
  getTotalQueuedTasks(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.size();
    }
    return total;
  }

  /**
   * Clears a worker's queue.
   *
   * @param worker - The worker whose queue to clear
   */
  clearQueue(worker: WorkerHandler): void {
    const queue = this.queues.get(worker);
    queue?.clear();
  }

  /**
   * Clears all worker queues.
   */
  clearAllQueues(): void {
    for (const queue of this.queues.values()) {
      queue.clear();
    }
  }

  /**
   * Attempts to steal work from the busiest worker for an idle worker.
   *
   * This is the core work-stealing operation. An idle worker calls this
   * to take tasks from a busy worker's queue, improving load balance.
   *
   * @param idleWorker - The worker that wants to steal work
   * @returns Array of stolen tasks (may be empty if no work to steal)
   */
  stealWork(idleWorker: WorkerHandler): T[] {
    const busiestWorker = this.findBusiestWorker(idleWorker);
    if (!busiestWorker) {
      return [];
    }

    const busiestQueue = this.queues.get(busiestWorker);
    const idleQueue = this.queues.get(idleWorker);

    if (!busiestQueue || !idleQueue) {
      return [];
    }

    // Steal half of the tasks from the busiest worker
    const stolen = busiestQueue.stealHalf();

    // Add stolen tasks to the idle worker's queue
    for (const task of stolen) {
      idleQueue.pushBack(task);
    }

    // Track statistics
    this.recordStealAttempt(stolen.length > 0);

    return stolen;
  }

  /**
   * Records a steal attempt for statistics.
   *
   * @param successful - Whether the steal was successful
   */
  recordStealAttempt(successful: boolean): void {
    this.stealAttempts++;
    if (successful) {
      this.successfulSteals++;
    }
  }

  /**
   * Gets the total number of steal attempts.
   */
  getStealAttempts(): number {
    return this.stealAttempts;
  }

  /**
   * Gets the number of successful steals.
   */
  getSuccessfulSteals(): number {
    return this.successfulSteals;
  }

  /**
   * Gets the steal success rate.
   *
   * @returns Success rate between 0 and 1, or 0 if no attempts
   */
  getStealSuccessRate(): number {
    if (this.stealAttempts === 0) {
      return 0;
    }
    return this.successfulSteals / this.stealAttempts;
  }

  /**
   * Gets comprehensive statistics about the pool state.
   */
  getStats(): WorkerPoolStats {
    let busyWorkers = 0;
    for (const worker of this.workers) {
      if (worker.isBusy()) {
        busyWorkers++;
      }
    }

    return {
      totalWorkers: this.workers.length,
      busyWorkers,
      idleWorkers: this.workers.length - busyWorkers,
      totalQueuedTasks: this.getTotalQueuedTasks(),
      stealAttempts: this.stealAttempts,
      successfulSteals: this.successfulSteals,
      stealSuccessRate: this.getStealSuccessRate(),
    };
  }
}
