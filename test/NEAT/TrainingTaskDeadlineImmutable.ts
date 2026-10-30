/**
 * Issue #4118: a scheduled training task has ONE deadline, fixed at scheduling.
 *
 * `scheduleTraining` used to derive the deadline three times: once for the
 * too-small-budget guard, once for the worker (it forwarded only the run's
 * hard deadline, so the worker re-anchored `now + trainingTimeOutMinutes` the
 * moment it dequeued the task) and once for the stuck-task watchdog (computed
 * after dispatch). Any time spent between scheduling and those points renewed
 * the budget, so the worker and the watchdog disagreed about when the task was
 * due.
 *
 * These tests drive the real `scheduleTraining` with an injected controlled
 * clock and a worker boundary that burns time during dispatch, and assert the
 * deadline the worker is handed and the one the watchdog records.
 */
import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { computeTimeoutTS } from "../../src/architecture/training/TrainingOutcome.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { scheduleTraining } from "../../src/NEAT/NeatScheduling.ts";
import { TRAINING_TASK_WATCHDOG_GRACE_MS } from "../../src/NEAT/PerTaskTrainingTimeout.ts";
import { TrainingRegressionTracker } from "../../src/NEAT/TrainingRegressionTracker.ts";
import type { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { WorkerTaskCancelledError } from "../../src/workers/WorkerTaskCancelledError.ts";
import { initWasmForTests } from "../_initWasm.ts";

const MINUTE = 60_000;
/** Time the worker boundary burns between the budget being fixed and the end. */
const DISPATCH_DELAY_MS = 90_000;
const T0 = 1_800_000_000_000;

/** A controlled clock: the test moves it forward explicitly. */
interface Clock {
  now: () => number;
  advance: (ms: number) => void;
}

function makeClock(): Clock {
  let t = T0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Records the options it is handed and burns time while dispatching. */
class DelayedWorker {
  lastOptions: TrainOptions | undefined;
  constructor(private readonly advance: (ms: number) => void) {}

  trainTracked(
    _creature: Creature,
    options: TrainOptions,
  ): { taskID: number; response: Promise<never> } {
    this.lastOptions = options;
    this.advance(DISPATCH_DELAY_MS);
    return { taskID: 1, response: new Promise<never>(() => {}) };
  }
}

function createStubNeat(
  worker: DelayedWorker,
  hardDeadlineTS: number,
): Neat {
  const pool = { selectWorker: () => worker, getIdleWorkers: () => [] };
  return {
    config: createNeatConfig({}),
    hardDeadlineTS,
    abandonEpoch: 0,
    trainingInProgress: new Map(),
    trainingDeadlines: new Map(),
    trainingTasks: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    heavyWorkerPool: pool,
    fastWorkerPool: pool,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

/**
 * Schedules one task on a stub run and returns what the worker got, what the
 * watchdog holds, and the clock (already advanced by the dispatch).
 */
function schedule(
  minutes: number,
  hardDeadlineTS: number,
  layers: number,
): { options: TrainOptions; recorded: number | undefined; clock: Clock } {
  const clock = makeClock();
  const worker = new DelayedWorker(clock.advance);
  const neat = createStubNeat(worker, hardDeadlineTS);
  const creature = new Creature(2, 1, { layers: [{ count: layers }] });
  scheduleTraining(neat, creature, minutes, undefined, undefined, clock.now);
  assert(worker.lastOptions, "training should have been dispatched");
  return {
    options: worker.lastOptions,
    recorded: neat.trainingDeadlines.get(CreatureUtil.makeUUID(creature)),
    clock,
  };
}

Deno.test("the worker and the watchdog share the deadline fixed at scheduling (Issue #4118)", async () => {
  await initWasmForTests();
  const { options, recorded } = schedule(5, 0, 2);
  const expected = T0 + 5 * MINUTE;

  // The dispatch burned 90 s, so a deadline derived after it would differ.
  assertEquals(
    recorded,
    expected,
    "watchdog deadline anchored at scheduling",
  );
  assertEquals(
    options.hardDeadlineTS,
    expected,
    "worker is handed the same absolute deadline",
  );
  assertEquals(options.hardDeadlineTS, recorded);
});

Deno.test("a worker that starts late cannot renew the task budget (Issue #4118)", async () => {
  await initWasmForTests();
  const { options, clock } = schedule(5, 0, 3);
  // The worker derives its own timeout from the options when it dequeues the
  // task — DISPATCH_DELAY_MS after scheduling — exactly as `createEpochState`.
  const workerTimeoutTS = computeTimeoutTS(
    clock.now(),
    options.trainingTimeOutMinutes ?? 0,
    options.hardDeadlineTS,
  );
  assertEquals(workerTimeoutTS, T0 + 5 * MINUTE);
});

Deno.test("an earlier run deadline wins over the task cap (Issue #4118)", async () => {
  await initWasmForTests();
  const runDeadline = T0 + 2 * MINUTE;
  const { options, recorded } = schedule(10, runDeadline, 4);
  assertEquals(recorded, runDeadline);
  assertEquals(options.hardDeadlineTS, runDeadline);
});

Deno.test("an earlier task cap is forwarded in place of the later run deadline (Issue #4118)", async () => {
  await initWasmForTests();
  const runDeadline = T0 + 30 * MINUTE;
  const { options, recorded } = schedule(1, runDeadline, 5);
  assertEquals(recorded, T0 + MINUTE);
  assertEquals(
    options.hardDeadlineTS,
    T0 + MINUTE,
    "the worker must stop at the task cap, not at the later run deadline",
  );
});

Deno.test("a disabled task cap leaves the run deadline in force (Issue #4118)", async () => {
  await initWasmForTests();
  const runDeadline = T0 + 20 * MINUTE;
  const { options, recorded } = schedule(0, runDeadline, 6);
  assertEquals(recorded, runDeadline);
  assertEquals(options.hardDeadlineTS, runDeadline);
  assertEquals(options.trainingTimeOutMinutes, 0);
});

Deno.test("no cap and no run deadline stays unbounded (Issue #4118)", async () => {
  await initWasmForTests();
  const { options, recorded } = schedule(0, 0, 7);
  assertEquals(options.hardDeadlineTS, undefined);
  assertEquals(options.trainingTimeOutMinutes, 0);
  assertEquals(recorded, 0, "0 is the watchdog's 'no deadline' sentinel");
});

Deno.test("the relative timeout still travels with the task (Issue #4118)", async () => {
  await initWasmForTests();
  const { options } = schedule(7, 0, 8);
  assertEquals(options.trainingTimeOutMinutes, 7);
});

/** A worker that never answers, so only the watchdog can end the task. */
class WedgedWorker {
  readonly cancelled: number[] = [];
  quarantinedFor: string | undefined;
  private healthy = true;
  private pending = new Map<number, (error: Error) => void>();

  isBusy(): boolean {
    return this.pending.size > 0;
  }
  isHealthy(): boolean {
    return this.healthy;
  }
  getCumulativeBusyMs(): number {
    return 0;
  }
  trainTracked(): { taskID: number; response: Promise<ResponseData> } {
    const response = new Promise<ResponseData>((_resolve, reject) => {
      this.pending.set(1, reject);
    });
    return { taskID: 1, response };
  }
  cancelTask(taskID: number, reason: string): boolean {
    const reject = this.pending.get(taskID);
    if (!reject) return false;
    this.pending.delete(taskID);
    this.cancelled.push(taskID);
    reject(
      new WorkerTaskCancelledError({
        taskID,
        workerID: 1,
        elapsedMs: 1_000,
        reason,
      }),
    );
    return true;
  }
  quarantine(reason: string): void {
    this.healthy = false;
    this.quarantinedFor = reason;
  }
}

Deno.test("the watchdog still waits its 30 s grace past the original deadline, then cancels (Issue #4118)", async () => {
  const worker = new WedgedWorker();
  const neat = new Neat(2, 1, { populationSize: 4 }, [
    worker as unknown as WorkerHandler,
  ]);
  const creature = new Creature(2, 1, { layers: [{ count: 9 }] });
  const uuid = CreatureUtil.makeUUID(creature);

  neat.scheduleTraining(creature, 5);
  const inFlight = neat.trainingInProgress.get(uuid);
  assert(inFlight, "the training promise is tracked");

  const deadline = neat.trainingDeadlines.get(uuid);
  assert(deadline !== undefined && deadline > 0, "a deadline is recorded");
  assertEquals(TRAINING_TASK_WATCHDOG_GRACE_MS, 30_000);

  // At the deadline plus the full grace the task is still given its chance…
  assertEquals(
    neat.abandonStuckTrainingTasks(
      deadline + TRAINING_TASK_WATCHDOG_GRACE_MS,
      TRAINING_TASK_WATCHDOG_GRACE_MS,
    ),
    [],
  );
  assertEquals(worker.cancelled.length, 0);

  // …and one millisecond later a genuinely unresponsive task is cancelled and
  // its worker quarantined.
  assertEquals(
    neat.abandonStuckTrainingTasks(
      deadline + TRAINING_TASK_WATCHDOG_GRACE_MS + 1,
      TRAINING_TASK_WATCHDOG_GRACE_MS,
    ),
    [uuid],
  );
  await inFlight;
  assertEquals(worker.cancelled, [1]);
  assertEquals(worker.isHealthy(), false);
});
