/**
 * Benchmark for WorkStealingQueue and WorkerPool performance.
 *
 * Issue #1290: Work-stealing queue for worker load balancing.
 *
 * This benchmark compares:
 * 1. Old approach: Random worker selection with linear scan fallback
 * 2. New approach: Work-stealing pool with intelligent selection
 *
 * Run with:
 *   deno bench --allow-read bench/WorkStealingPool.ts
 */
import { WorkStealingQueue } from "../src/multithreading/WorkStealingQueue.ts";
import { WorkerPool } from "../src/multithreading/WorkerPool.ts";
import type { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

// Test task interface
interface TestTask {
  id: number;
  estimatedDuration: number;
}

/**
 * Mock worker handler for benchmarking.
 */
class MockBenchWorker {
  private _busy = false;

  isBusy(): boolean {
    return this._busy;
  }

  setBusy(busy: boolean): void {
    this._busy = busy;
  }
}

/**
 * Old approach: Random selection with linear scan fallback.
 */
function selectWorkerOld(workers: MockBenchWorker[]): MockBenchWorker {
  // Random selection
  let w = workers[Math.floor(Math.random() * workers.length)];

  // Linear scan fallback if busy
  if (w.isBusy()) {
    for (let i = workers.length; i--;) {
      const tmpWorker = workers[i];
      if (!tmpWorker.isBusy()) {
        w = tmpWorker;
        break;
      }
    }
  }

  return w;
}

// Create mock workers for benchmarking
function createMockWorkers(count: number): MockBenchWorker[] {
  const workers: MockBenchWorker[] = [];
  for (let i = 0; i < count; i++) {
    workers.push(new MockBenchWorker());
  }
  return workers;
}

// Benchmark configuration
const WORKER_COUNT = 8;
const SELECTION_COUNT = 10000;

// Create workers
const oldWorkers = createMockWorkers(WORKER_COUNT);
const newWorkers = createMockWorkers(
  WORKER_COUNT,
) as unknown as WorkerHandler[];
const pool = new WorkerPool(newWorkers);

console.log(`Worker count: ${WORKER_COUNT}`);
console.log(`Selection iterations: ${SELECTION_COUNT}`);

// ============================================
// Benchmark: Worker Selection (all idle)
// ============================================

Deno.bench({
  name: "Old: Random selection (all workers idle)",
  group: "Worker Selection (idle)",
  baseline: true,
  fn() {
    for (let i = 0; i < SELECTION_COUNT; i++) {
      selectWorkerOld(oldWorkers);
    }
  },
});

Deno.bench({
  name: "New: WorkerPool.selectWorker (all idle)",
  group: "Worker Selection (idle)",
  fn() {
    for (let i = 0; i < SELECTION_COUNT; i++) {
      pool.selectWorker();
    }
  },
});

// ============================================
// Benchmark: Worker Selection (all busy)
// ============================================

// Set all workers busy for "all busy" scenario
const oldBusyWorkers = createMockWorkers(WORKER_COUNT);
oldBusyWorkers.forEach((w) => w.setBusy(true));

const newBusyWorkers = createMockWorkers(
  WORKER_COUNT,
) as unknown as WorkerHandler[];
newBusyWorkers.forEach((w) => (w as unknown as MockBenchWorker).setBusy(true));
const busyPool = new WorkerPool(newBusyWorkers);

Deno.bench({
  name: "Old: Random + linear scan (all workers busy)",
  group: "Worker Selection (busy)",
  baseline: true,
  fn() {
    for (let i = 0; i < SELECTION_COUNT; i++) {
      selectWorkerOld(oldBusyWorkers);
    }
  },
});

Deno.bench({
  name: "New: WorkerPool.selectWorker (all busy)",
  group: "Worker Selection (busy)",
  fn() {
    for (let i = 0; i < SELECTION_COUNT; i++) {
      busyPool.selectWorker();
    }
  },
});

// ============================================
// Benchmark: WorkStealingQueue Operations
// ============================================

const QUEUE_OPS = 10000;

Deno.bench({
  name: "WorkStealingQueue: pushBack + popFront",
  group: "Queue Operations",
  baseline: true,
  fn() {
    const queue = new WorkStealingQueue<TestTask>();
    for (let i = 0; i < QUEUE_OPS; i++) {
      queue.pushBack({ id: i, estimatedDuration: 100 });
    }
    for (let i = 0; i < QUEUE_OPS; i++) {
      queue.popFront();
    }
  },
});

Deno.bench({
  name: "WorkStealingQueue: mixed pushBack/popFront/popBack",
  group: "Queue Operations",
  fn() {
    const queue = new WorkStealingQueue<TestTask>();
    for (let i = 0; i < QUEUE_OPS; i++) {
      queue.pushBack({ id: i, estimatedDuration: 100 });
      if (i % 3 === 0) {
        queue.popFront();
      } else if (i % 5 === 0) {
        queue.popBack();
      }
    }
  },
});

// ============================================
// Benchmark: Steal Operations
// ============================================

Deno.bench({
  name: "WorkStealingQueue: stealHalf from 1000 items",
  group: "Steal Operations",
  baseline: true,
  fn() {
    const queue = new WorkStealingQueue<TestTask>();
    for (let i = 0; i < 1000; i++) {
      queue.pushBack({ id: i, estimatedDuration: 100 });
    }
    for (let i = 0; i < 10; i++) {
      queue.stealHalf();
    }
  },
});

Deno.bench({
  name: "WorkerPool: stealWork simulation",
  group: "Steal Operations",
  fn() {
    // Create pool with queued tasks
    const stealWorkers = createMockWorkers(4) as unknown as WorkerHandler[];
    const stealPool = new WorkerPool<TestTask>(stealWorkers);

    // Queue tasks to first worker
    for (let i = 0; i < 1000; i++) {
      stealPool.queueTask(stealWorkers[0], { id: i, estimatedDuration: 100 });
    }

    // Steal work to other workers
    for (let i = 1; i < 4; i++) {
      stealPool.stealWork(stealWorkers[i]);
    }
  },
});

// ============================================
// Benchmark: Workload-based Selection
// ============================================

Deno.bench({
  name: "WorkerPool: selectWorkerByWorkload",
  group: "Workload Selection",
  fn() {
    const wlWorkers = createMockWorkers(
      WORKER_COUNT,
    ) as unknown as WorkerHandler[];
    wlWorkers.forEach((w) => (w as unknown as MockBenchWorker).setBusy(true));
    const wlPool = new WorkerPool<TestTask>(wlWorkers);

    // Queue tasks with varying durations
    for (let i = 0; i < 100; i++) {
      wlPool.queueTask(
        wlWorkers[i % WORKER_COUNT],
        { id: i, estimatedDuration: (i % 10) * 100 },
      );
    }

    // Select workers based on workload
    for (let i = 0; i < SELECTION_COUNT; i++) {
      wlPool.selectWorkerByWorkload((task) => task.estimatedDuration);
    }
  },
});

// ============================================
// Benchmark: Estimated Workload Calculation
// ============================================

Deno.bench({
  name: "WorkStealingQueue: getEstimatedWorkload",
  group: "Workload Estimation",
  fn() {
    const queue = new WorkStealingQueue<TestTask>();
    for (let i = 0; i < 1000; i++) {
      queue.pushBack({ id: i, estimatedDuration: (i % 10) * 100 });
    }

    for (let i = 0; i < 1000; i++) {
      queue.getEstimatedWorkload((task) => task.estimatedDuration);
    }
  },
});
