/**
 * Issue #1290 - Work-stealing queue for worker load balancing
 *
 * A concurrent deque (double-ended queue) implementation that enables
 * work-stealing patterns for better load distribution across workers.
 *
 * The owner (worker) pushes and pops from the front, while thieves
 * (idle workers) steal from the back. This allows idle workers to
 * help busy workers complete their tasks.
 *
 * Key features:
 * - FIFO ordering for owner operations (pushBack/popFront)
 * - LIFO stealing from back (popBack) for thieves
 * - Estimated workload calculation for smarter stealing decisions
 * - Bulk steal operation (stealHalf) for efficient load rebalancing
 *
 * @example
 * ```ts
 * const queue = new WorkStealingQueue<Task>();
 *
 * // Owner adds work
 * queue.pushBack(task1);
 * queue.pushBack(task2);
 *
 * // Owner processes from front
 * const myTask = queue.popFront();
 *
 * // Thief steals from back
 * const stolenTask = queue.popBack();
 * ```
 */
export class WorkStealingQueue<T> {
  /** Internal array storage for the deque */
  private items: T[] = [];

  /**
   * Adds a task to the back of the queue.
   *
   * This is the primary method for the owner to add new tasks.
   * Time complexity: O(1) amortised
   *
   * @param task - The task to add to the queue
   */
  pushBack(task: T): void {
    this.items.push(task);
  }

  /**
   * Removes and returns a task from the front of the queue.
   *
   * This is the primary method for the owner to retrieve tasks.
   * Time complexity: O(n) due to array shift, but acceptable for our workloads
   *
   * @returns The task from the front, or undefined if the queue is empty
   */
  popFront(): T | undefined {
    return this.items.shift();
  }

  /**
   * Removes and returns a task from the back of the queue.
   *
   * This is the stealing operation used by idle workers to take
   * tasks from busy workers' queues.
   * Time complexity: O(1)
   *
   * @returns The task from the back, or undefined if the queue is empty
   */
  popBack(): T | undefined {
    return this.items.pop();
  }

  /**
   * Returns the task at the front of the queue without removing it.
   *
   * Useful for inspecting the next task to be processed.
   *
   * @returns The task at the front, or undefined if the queue is empty
   */
  peek(): T | undefined {
    return this.items[0];
  }

  /**
   * Returns the task at the back of the queue without removing it.
   *
   * Useful for thieves to inspect what they might steal.
   *
   * @returns The task at the back, or undefined if the queue is empty
   */
  peekBack(): T | undefined {
    return this.items[this.items.length - 1];
  }

  /**
   * Returns the number of tasks in the queue.
   *
   * @returns The current queue size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Checks if the queue is empty.
   *
   * @returns True if the queue has no tasks, false otherwise
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Removes all tasks from the queue.
   */
  clear(): void {
    this.items.length = 0;
  }

  /**
   * Returns a copy of all tasks in the queue as an array.
   *
   * The original queue is not modified.
   *
   * @returns Array of tasks in queue order (front to back)
   */
  toArray(): T[] {
    return [...this.items];
  }

  /**
   * Calculates the estimated total workload in the queue.
   *
   * This enables smarter stealing decisions based on actual
   * estimated completion times rather than just task counts.
   *
   * @param estimator - Function to estimate duration for a task
   * @returns Total estimated workload across all tasks
   */
  getEstimatedWorkload(estimator: (task: T) => number): number {
    let total = 0;
    for (const task of this.items) {
      total += estimator(task);
    }
    return total;
  }

  /**
   * Steals approximately half the tasks from the back of the queue.
   *
   * This is useful for bulk rebalancing when a worker becomes idle
   * and wants to take a substantial portion of work from a busy worker.
   *
   * The stolen tasks are taken from the back of the queue, so they
   * are the most recently added (and likely least time-critical) tasks.
   *
   * @returns Array of stolen tasks (from back towards front)
   */
  stealHalf(): T[] {
    const halfCount = Math.floor(this.items.length / 2);
    if (halfCount === 0) {
      return [];
    }

    // Splice from the middle to the end
    const startIndex = this.items.length - halfCount;
    const stolen = this.items.splice(startIndex, halfCount);

    return stolen;
  }
}
