/**
 * A quarantined worker must never be selected for new work (GRQ #4489).
 *
 * A worker that swallowed a training task is wedged: handing it the next
 * creature buys another stuck task. On GRQ-22-rocket the same two task ids
 * were abandoned twice in one run. The pool therefore skips workers the
 * handler has reported unhealthy, and only falls back to them when there is
 * nothing else left.
 */
import { assertEquals } from "@std/assert";
import { WorkerPool } from "@multithreading/WorkerPool.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

/** Minimal stand-in for the slice of `WorkerHandler` the pool uses. */
class StubWorker {
  private busy: boolean;
  private healthy: boolean;

  constructor(
    public readonly label: string,
    busy = false,
    healthy = true,
  ) {
    this.busy = busy;
    this.healthy = healthy;
  }

  isBusy(): boolean {
    return this.busy;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  getCumulativeBusyMs(): number {
    return 0;
  }
}

function pool(workers: StubWorker[]): WorkerPool {
  return new WorkerPool(workers as unknown[] as WorkerHandler[]);
}

Deno.test("selectWorker skips a quarantined worker (GRQ #4489)", () => {
  const wedged = new StubWorker("wedged", false, false);
  const healthy = new StubWorker("healthy", false, true);

  assertEquals(
    pool([wedged, healthy]).selectWorker(),
    healthy as unknown as WorkerHandler,
    "an idle but quarantined worker must not be picked ahead of a healthy one",
  );
});

Deno.test("selectWorker prefers a busy healthy worker over a quarantined idle one (GRQ #4489)", () => {
  const wedged = new StubWorker("wedged", false, false);
  const busy = new StubWorker("busy", true, true);

  assertEquals(
    pool([wedged, busy]).selectWorker(),
    busy as unknown as WorkerHandler,
    "a wedged isolate is worse than a queue on a working one",
  );
});

Deno.test("selectWorker returns undefined when every worker is quarantined (GRQ #4489)", () => {
  const selected = pool([
    new StubWorker("wedged-1", false, false),
    new StubWorker("wedged-2", true, false),
  ]).selectWorker();

  assertEquals(
    selected,
    undefined,
    "no worker is better than a wedged one — the caller logs and skips",
  );
});

Deno.test("getIdleWorkers excludes quarantined workers (GRQ #4489)", () => {
  const wedged = new StubWorker("wedged", false, false);
  const idle = new StubWorker("idle", false, true);

  assertEquals(
    pool([wedged, idle]).getIdleWorkers(),
    [idle] as unknown[] as WorkerHandler[],
  );
});

Deno.test("selectWorkerByWorkload skips quarantined workers (GRQ #4489)", () => {
  const wedged = new StubWorker("wedged", false, false);
  const healthy = new StubWorker("healthy", false, true);

  assertEquals(
    pool([wedged, healthy]).selectWorkerByWorkload(() => 1),
    healthy as unknown as WorkerHandler,
  );
});
