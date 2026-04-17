/**
 * Tests for cross-pool borrowing — idle fast workers assisting heavy tasks
 * when the heavy pool is saturated (Issue #2329).
 *
 * When the heavy pool has no idle workers and `allowPoolBorrowing` is enabled,
 * `scheduleDiscovery()` and `scheduleTraining()` should borrow an idle fast
 * worker rather than dropping the task.
 */
import { assertEquals } from "@std/assert";
import { WorkerPool } from "@multithreading/WorkerPool.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

/**
 * Minimal mock worker implementing the subset of WorkerHandler needed
 * by WorkerPool. We only need `isBusy()` and `getCumulativeBusyMs()` for
 * pool selection and idle-worker detection.
 */
class StubWorker {
  private _busy = false;
  public label: string;

  constructor(label: string, busy = false) {
    this.label = label;
    this._busy = busy;
  }

  isBusy(): boolean {
    return this._busy;
  }

  setBusy(busy: boolean): void {
    this._busy = busy;
  }

  getCumulativeBusyMs(): number {
    return 0;
  }
}

// ============================================================================
// WorkerPool.getIdleWorkers — verifies the building block
// ============================================================================

Deno.test(
  "WorkerPool.getIdleWorkers returns only non-busy workers with empty queues",
  () => {
    const idle1 = new StubWorker("idle-1", false);
    const busy1 = new StubWorker("busy-1", true);
    const idle2 = new StubWorker("idle-2", false);

    const pool = new WorkerPool(
      [idle1, busy1, idle2] as unknown[] as WorkerHandler[],
    );

    const idleWorkers = pool.getIdleWorkers();
    assertEquals(idleWorkers.length, 2, "Should have 2 idle workers");
    assertEquals(idleWorkers[0], idle1 as unknown as WorkerHandler);
    assertEquals(idleWorkers[1], idle2 as unknown as WorkerHandler);
  },
);

// ============================================================================
// WorkerPool.selectWorker — saturated pool returns undefined-ish or busy
// ============================================================================

Deno.test(
  "WorkerPool.selectWorker returns idle worker when available",
  () => {
    const idle = new StubWorker("idle", false);
    const busy = new StubWorker("busy", true);

    const pool = new WorkerPool(
      [busy, idle] as unknown[] as WorkerHandler[],
    );

    const selected = pool.selectWorker();
    assertEquals(
      selected,
      idle as unknown as WorkerHandler,
      "Should select the idle worker",
    );
  },
);

Deno.test(
  "WorkerPool.selectWorker returns a busy worker when all are busy (saturated)",
  () => {
    const busy1 = new StubWorker("busy-1", true);
    const busy2 = new StubWorker("busy-2", true);

    const pool = new WorkerPool(
      [busy1, busy2] as unknown[] as WorkerHandler[],
    );

    // When all workers are busy, selectWorker still returns one (least loaded)
    const selected = pool.selectWorker();
    assertEquals(
      selected !== undefined,
      true,
      "Should still return a worker even when all are busy",
    );
  },
);

// ============================================================================
// Cross-pool borrowing logic — simulates the scheduling fallback
// ============================================================================

/**
 * Simulates the pool borrowing logic from scheduleDiscovery/scheduleTraining.
 * This mirrors the exact pattern used in NeatScheduling.ts (Issue #2329).
 */
function selectWorkerWithBorrowing(
  heavyPool: WorkerPool,
  fastPool: WorkerPool,
  allowPoolBorrowing: boolean,
): WorkerHandler | undefined {
  // Step 1: Try heavy pool first
  let w = heavyPool.selectWorker();

  // Step 2: If heavy pool has no idle workers and borrowing is allowed,
  // fall back to idle fast workers
  if (w && (w as unknown as StubWorker).isBusy() === false) {
    // Heavy pool has an idle worker — use it directly
    return w;
  }

  // All heavy workers are busy; check fast pool if borrowing is enabled
  if (allowPoolBorrowing && fastPool !== heavyPool) {
    const idleFastWorkers = fastPool.getIdleWorkers();
    if (idleFastWorkers.length > 0) {
      w = idleFastWorkers[0];
      return w;
    }
  }

  return w; // May be a busy heavy worker or undefined
}

Deno.test(
  "Pool borrowing: idle fast worker is used when heavy pool is saturated",
  () => {
    const heavyBusy1 = new StubWorker("heavy-1", true);
    const heavyBusy2 = new StubWorker("heavy-2", true);
    const fastIdle1 = new StubWorker("fast-1", false);
    const fastIdle2 = new StubWorker("fast-2", false);

    const heavyPool = new WorkerPool(
      [heavyBusy1, heavyBusy2] as unknown[] as WorkerHandler[],
    );
    const fastPool = new WorkerPool(
      [fastIdle1, fastIdle2] as unknown[] as WorkerHandler[],
    );

    const selected = selectWorkerWithBorrowing(heavyPool, fastPool, true);

    assertEquals(
      selected,
      fastIdle1 as unknown as WorkerHandler,
      "Should borrow the first idle fast worker when heavy pool is saturated",
    );
  },
);

Deno.test(
  "Pool borrowing: disabled via config — no borrowing occurs",
  () => {
    const heavyBusy = new StubWorker("heavy-1", true);
    const fastIdle = new StubWorker("fast-1", false);

    const heavyPool = new WorkerPool(
      [heavyBusy] as unknown[] as WorkerHandler[],
    );
    const fastPool = new WorkerPool(
      [fastIdle] as unknown[] as WorkerHandler[],
    );

    const selected = selectWorkerWithBorrowing(heavyPool, fastPool, false);

    // Should NOT return the idle fast worker; instead returns the busy heavy worker
    assertEquals(
      selected,
      heavyBusy as unknown as WorkerHandler,
      "Should NOT borrow fast worker when allowPoolBorrowing is false",
    );
  },
);

Deno.test(
  "Pool borrowing: heavy pool has idle worker — no borrowing needed",
  () => {
    const heavyIdle = new StubWorker("heavy-idle", false);
    const heavyBusy = new StubWorker("heavy-busy", true);
    const fastIdle = new StubWorker("fast-1", false);

    const heavyPool = new WorkerPool(
      [heavyIdle, heavyBusy] as unknown[] as WorkerHandler[],
    );
    const fastPool = new WorkerPool(
      [fastIdle] as unknown[] as WorkerHandler[],
    );

    const selected = selectWorkerWithBorrowing(heavyPool, fastPool, true);

    assertEquals(
      selected,
      heavyIdle as unknown as WorkerHandler,
      "Should use idle heavy worker — no borrowing needed",
    );
  },
);

Deno.test(
  "Pool borrowing: shared pool (non-partitioned) — no borrowing attempted",
  () => {
    const worker1 = new StubWorker("shared-1", true);
    const worker2 = new StubWorker("shared-2", false);

    // When pools are not partitioned, fastPool === heavyPool
    const sharedPool = new WorkerPool(
      [worker1, worker2] as unknown[] as WorkerHandler[],
    );

    const selected = selectWorkerWithBorrowing(
      sharedPool,
      sharedPool,
      true,
    );

    assertEquals(
      selected,
      worker2 as unknown as WorkerHandler,
      "Should use idle worker from shared pool without borrowing logic",
    );
  },
);

Deno.test(
  "Pool borrowing: both pools fully saturated — returns busy heavy worker",
  () => {
    const heavyBusy = new StubWorker("heavy-1", true);
    const fastBusy = new StubWorker("fast-1", true);

    const heavyPool = new WorkerPool(
      [heavyBusy] as unknown[] as WorkerHandler[],
    );
    const fastPool = new WorkerPool(
      [fastBusy] as unknown[] as WorkerHandler[],
    );

    const selected = selectWorkerWithBorrowing(heavyPool, fastPool, true);

    // Both pools busy — should still return the heavy worker (busy, but available)
    assertEquals(
      selected,
      heavyBusy as unknown as WorkerHandler,
      "Should fall back to busy heavy worker when both pools are saturated",
    );
  },
);

// ============================================================================
// Config flag default behaviour
// ============================================================================

Deno.test(
  "allowPoolBorrowing defaults to true in NeatConfig",
  async () => {
    const { createNeatConfig } = await import("@config/NeatConfig.ts");
    const config = createNeatConfig({});
    assertEquals(
      config.allowPoolBorrowing,
      true,
      "allowPoolBorrowing should default to true",
    );
  },
);

Deno.test(
  "allowPoolBorrowing can be disabled via config",
  async () => {
    const { createNeatConfig } = await import("@config/NeatConfig.ts");
    const config = createNeatConfig({ allowPoolBorrowing: false });
    assertEquals(
      config.allowPoolBorrowing,
      false,
      "allowPoolBorrowing should be false when explicitly disabled",
    );
  },
);

Deno.test(
  "allowPoolBorrowing can be explicitly enabled via config",
  async () => {
    const { createNeatConfig } = await import("@config/NeatConfig.ts");
    const config = createNeatConfig({ allowPoolBorrowing: true });
    assertEquals(
      config.allowPoolBorrowing,
      true,
      "allowPoolBorrowing should be true when explicitly enabled",
    );
  },
);
