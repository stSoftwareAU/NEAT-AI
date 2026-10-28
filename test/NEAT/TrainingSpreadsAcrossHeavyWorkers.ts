/**
 * Scheduled training must spread across busy heavy workers, not pile onto the
 * first one (Issue #4095).
 *
 * `scheduleTraining` dispatches straight to a worker through `trainTracked` and
 * never touches the pool's work-stealing queues. When every heavy worker is
 * busy, `WorkerPool.selectWorker` ranks them by in-flight load. That load must
 * count the tasks already dispatched to each worker (`getPendingTaskCount`),
 * otherwise every queue reads 0 and every new task lands on the first worker.
 *
 * These tests drive the real `scheduleTraining` → `selectWorker` path with
 * workers that never answer, and assert where each task was dispatched.
 */
import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";

/**
 * A heavy worker whose training requests never return. It records every task
 * `scheduleTraining` dispatches to it, and reports the dispatched-but-unsettled
 * count the way `WorkerHandlerBase.getPendingTaskCount` does.
 */
class TrainingWorker {
  /** Creatures dispatched by `scheduleTraining`, in order. */
  public readonly dispatched: Creature[] = [];
  /** The task label each dispatch carried, in the same order as `dispatched`. */
  public readonly labels: string[] = [];
  private pending = 0;

  constructor(public readonly label: string) {}

  isBusy(): boolean {
    return this.pending > 0;
  }

  isHealthy(): boolean {
    return true;
  }

  getPendingTaskCount(): number {
    return this.pending;
  }

  getCumulativeBusyMs(): number {
    return 0;
  }

  /** A task dispatched before the scheduling under test: busy, not recorded. */
  seedInFlightTask(): void {
    this.pending++;
  }

  trainTracked(
    creature: Creature,
    _options?: unknown,
    label: string = "",
  ): { taskID: number; response: Promise<ResponseData> } {
    this.dispatched.push(creature);
    this.labels.push(label);
    this.pending++;
    const taskID = this.dispatched.length;
    // Never settles: the worker is wedged for the whole test.
    const response = new Promise<ResponseData>(() => {});
    return { taskID, response };
  }
}

function neatWithHeavyWorkers(
  workers: TrainingWorker[],
): Neat {
  const options: NeatOptions = { populationSize: 4 };
  return new Neat(
    2,
    1,
    options,
    workers as unknown as WorkerHandler[],
  );
}

Deno.test("two training tasks land on two busy heavy workers, one each (Issue #4095)", () => {
  const heavy1 = new TrainingWorker("heavy-1");
  const heavy2 = new TrainingWorker("heavy-2");
  // Both heavy workers already have one training task in flight.
  heavy1.seedInFlightTask();
  heavy2.seedInFlightTask();

  const neat = neatWithHeavyWorkers([heavy1, heavy2]);
  const first = new Creature(2, 1, { layers: [{ count: 2 }] });
  const second = new Creature(2, 1, { layers: [{ count: 3 }] });

  neat.scheduleTraining(first, 5);
  neat.scheduleTraining(second, 5);

  assertEquals(
    neat.trainingInProgress.size,
    2,
    "both tasks were dispatched",
  );
  assertEquals(
    heavy1.dispatched.length,
    1,
    "the first task goes to heavy-1 (tie on load)",
  );
  assertEquals(
    heavy2.dispatched.length,
    1,
    "the second task goes to heavy-2, not piled onto heavy-1",
  );
  assertEquals(heavy1.dispatched[0], first);
  assertEquals(heavy2.dispatched[0], second);

  // Each dispatch is labelled with its creature's uuid, so a quarantine of the
  // worker names the task (Issue #4095).
  assertEquals(
    heavy1.labels[0],
    CreatureUtil.makeUUID(first),
    "heavy-1's task is labelled with the first creature's uuid",
  );
  assertEquals(
    heavy2.labels[0],
    CreatureUtil.makeUUID(second),
    "heavy-2's task is labelled with the second creature's uuid",
  );
});
