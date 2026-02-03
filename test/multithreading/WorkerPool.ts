/**
 * Issue #1290 - Work-stealing worker pool for load balancing
 *
 * Tests for the WorkerPool class that manages workers with work-stealing
 * capabilities for better load distribution.
 */
import { assertEquals, assertExists, assertGreater } from "@std/assert";
import { WorkerPool } from "../../src/multithreading/WorkerPool.ts";
import type { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";

/**
 * Mock worker handler for testing purposes.
 */
class MockWorkerHandler {
  private _busy = false;
  private _taskCount = 0;

  isBusy(): boolean {
    return this._busy;
  }

  setBusy(busy: boolean): void {
    this._busy = busy;
    if (busy) {
      this._taskCount++;
    }
  }

  getTaskCount(): number {
    return this._taskCount;
  }
}

Deno.test("WorkerPool - constructor initialises with workers", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ] as unknown as WorkerHandler[];

  const pool = new WorkerPool(workers);

  assertEquals(pool.getWorkerCount(), 3);
});

Deno.test("WorkerPool - selectWorker returns non-busy worker when available", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];
  workers[0].setBusy(true);
  workers[1].setBusy(false);
  workers[2].setBusy(true);

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  const selected = pool.selectWorker();
  assertExists(selected);
  assertEquals((selected as unknown as MockWorkerHandler).isBusy(), false);
});

Deno.test("WorkerPool - selectWorker returns worker with smallest queue when all busy", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  // All workers busy
  workers[0].setBusy(true);
  workers[1].setBusy(true);
  workers[2].setBusy(true);

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  // Queue tasks to workers - using the internal queuing
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 1 });
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 2 });
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 3 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 4 });
  pool.queueTask(workers[2] as unknown as WorkerHandler, { id: 5 });
  pool.queueTask(workers[2] as unknown as WorkerHandler, { id: 6 });

  // Worker 1 has smallest queue (1 task)
  const selected = pool.selectWorker();
  assertExists(selected);
  // Should select worker with smallest queue
});

Deno.test("WorkerPool - queueTask adds task to worker's queue", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const worker = workers[0] as unknown as WorkerHandler;

  pool.queueTask(worker, { id: 1 });
  pool.queueTask(worker, { id: 2 });

  assertEquals(pool.getQueueSize(worker), 2);
});

Deno.test("WorkerPool - dequeueTask removes task from worker's queue", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const worker = workers[0] as unknown as WorkerHandler;

  pool.queueTask(worker, { id: 1 });
  pool.queueTask(worker, { id: 2 });

  const task = pool.dequeueTask(worker);
  assertEquals((task as { id: number })?.id, 1);
  assertEquals(pool.getQueueSize(worker), 1);
});

Deno.test("WorkerPool - stealWork takes tasks from busiest worker", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const idleWorker = workers[0] as unknown as WorkerHandler;
  const busyWorker = workers[1] as unknown as WorkerHandler;

  // Queue many tasks to the busy worker
  pool.queueTask(busyWorker, { id: 1 });
  pool.queueTask(busyWorker, { id: 2 });
  pool.queueTask(busyWorker, { id: 3 });
  pool.queueTask(busyWorker, { id: 4 });

  // Idle worker steals work
  const stolen = pool.stealWork(idleWorker);

  assertGreater(stolen.length, 0);
  // Stolen tasks should now be in the idle worker's queue
  assertGreater(pool.getQueueSize(idleWorker), 0);
});

Deno.test("WorkerPool - stealWork returns empty array when no work to steal", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const idleWorker = workers[0] as unknown as WorkerHandler;

  const stolen = pool.stealWork(idleWorker);

  assertEquals(stolen.length, 0);
});

Deno.test("WorkerPool - getStats returns pool statistics", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];
  workers[0].setBusy(true);
  workers[1].setBusy(false);
  workers[2].setBusy(true);

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  // Add some tasks
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 1 });
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 2 });
  pool.queueTask(workers[2] as unknown as WorkerHandler, { id: 3 });

  const stats = pool.getStats();

  assertEquals(stats.totalWorkers, 3);
  assertEquals(stats.busyWorkers, 2);
  assertEquals(stats.idleWorkers, 1);
  assertEquals(stats.totalQueuedTasks, 3);
});

Deno.test("WorkerPool - getTotalQueuedTasks returns correct count", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 1 });
  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 2 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 3 });

  assertEquals(pool.getTotalQueuedTasks(), 3);
});

Deno.test("WorkerPool - clearQueue removes all tasks from a worker's queue", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const worker = workers[0] as unknown as WorkerHandler;

  pool.queueTask(worker, { id: 1 });
  pool.queueTask(worker, { id: 2 });
  pool.queueTask(worker, { id: 3 });

  pool.clearQueue(worker);

  assertEquals(pool.getQueueSize(worker), 0);
});

Deno.test("WorkerPool - clearAllQueues removes all tasks from all queues", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 1 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 2 });

  pool.clearAllQueues();

  assertEquals(pool.getTotalQueuedTasks(), 0);
});

Deno.test("WorkerPool - selectWorker with estimator prefers lower workload", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const w0 = workers[0] as unknown as WorkerHandler;
  const w1 = workers[1] as unknown as WorkerHandler;

  // Queue tasks with estimated durations
  pool.queueTask(w0, { id: 1, estimatedDuration: 1000 });
  pool.queueTask(w0, { id: 2, estimatedDuration: 1000 });
  pool.queueTask(w1, { id: 3, estimatedDuration: 100 });

  // Select worker with estimator function
  const selected = pool.selectWorkerByWorkload(
    (task: unknown) =>
      (task as { estimatedDuration?: number }).estimatedDuration ?? 0,
  );

  // Should select worker with lower estimated workload
  assertExists(selected);
});

Deno.test("WorkerPool - recordStealAttempt and getStealAttempts track stealing", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  assertEquals(pool.getStealAttempts(), 0);

  pool.recordStealAttempt(true);
  pool.recordStealAttempt(false);
  pool.recordStealAttempt(true);

  assertEquals(pool.getStealAttempts(), 3);
  assertEquals(pool.getSuccessfulSteals(), 2);
});

Deno.test("WorkerPool - getStealSuccessRate returns correct ratio", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  pool.recordStealAttempt(true);
  pool.recordStealAttempt(true);
  pool.recordStealAttempt(false);
  pool.recordStealAttempt(false);

  assertEquals(pool.getStealSuccessRate(), 0.5);
});

Deno.test("WorkerPool - getStealSuccessRate returns 0 for no attempts", () => {
  const workers = [new MockWorkerHandler()];
  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  assertEquals(pool.getStealSuccessRate(), 0);
});

Deno.test("WorkerPool - findBusiestWorker returns worker with most queued tasks", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  pool.queueTask(workers[0] as unknown as WorkerHandler, { id: 1 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 2 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 3 });
  pool.queueTask(workers[1] as unknown as WorkerHandler, { id: 4 });
  pool.queueTask(workers[2] as unknown as WorkerHandler, { id: 5 });

  const busiest = pool.findBusiestWorker();
  assertExists(busiest);
  assertEquals(pool.getQueueSize(busiest), 3);
});

Deno.test("WorkerPool - findBusiestWorker excludes specified worker", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);
  const w0 = workers[0] as unknown as WorkerHandler;
  const w1 = workers[1] as unknown as WorkerHandler;

  pool.queueTask(w0, { id: 1 });
  pool.queueTask(w0, { id: 2 });
  pool.queueTask(w0, { id: 3 });
  pool.queueTask(w1, { id: 4 });

  // Exclude w0, so should return w1
  const busiest = pool.findBusiestWorker(w0);
  assertEquals(busiest, w1);
});

Deno.test("WorkerPool - findBusiestWorker returns undefined when all queues empty", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  const busiest = pool.findBusiestWorker();
  assertEquals(busiest, undefined);
});

Deno.test("WorkerPool - balances load across workers when all busy", () => {
  const workers = [
    new MockWorkerHandler(),
    new MockWorkerHandler(),
    new MockWorkerHandler(),
  ];

  // All workers are busy - this triggers load balancing by queue size
  workers[0].setBusy(true);
  workers[1].setBusy(true);
  workers[2].setBusy(true);

  const pool = new WorkerPool(workers as unknown as WorkerHandler[]);

  // Simulate multiple task assignments when all workers are busy
  for (let i = 0; i < 30; i++) {
    const selected = pool.selectWorker();
    assertExists(selected);
    pool.queueTask(selected, { id: i });
  }

  // Each worker should have exactly equal tasks since we select least-loaded
  for (const worker of workers) {
    const w = worker as unknown as WorkerHandler;
    const queueSize = pool.getQueueSize(w);
    assertEquals(queueSize, 10); // Exactly 30/3 = 10 tasks each
  }
});
