/**
 * The stuck-task watchdog must cancel the training task, not merely forget it
 * (GRQ #4489).
 *
 * `abandonStuckTrainingTasks` (#3053) dropped the UUID from
 * `trainingInProgress`/`trainingDeadlines` and left the worker request in
 * flight. Nothing else ever settled that promise, so on the GRQ fleet every
 * abandoned task reported `outcome=abandoned … reason=watchdog-abandoned` with
 * no error, no timing and no partial result, and the wedged worker was handed
 * the next creature. Seven of 27 hosts returned `scheduled=N completed=0` that
 * way on 2026-08-28.
 *
 * These tests drive the real `scheduleTraining` → watchdog path with a worker
 * that never answers, and assert the outcome an operator can act on: the
 * promise settles as a failure, the reason names the task, and the worker that
 * swallowed it is quarantined instead of taking more work.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { WorkerTaskCancelledError } from "@workers/WorkerTaskCancelledError.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/**
 * A worker whose training request never returns — the wedged isolate this
 * issue is about. It implements the slice of `WorkerHandler` that the pool and
 * `scheduleTraining` touch.
 */
class WedgedWorker {
  public readonly cancelled: { taskID: number; reason: string }[] = [];
  public quarantinedFor: string | undefined;
  private healthy = true;
  private pending = new Map<number, (error: Error) => void>();
  private nextTaskID = 1;

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
    const taskID = this.nextTaskID++;
    const response = new Promise<ResponseData>((_resolve, reject) => {
      this.pending.set(taskID, reject);
    });
    return { taskID, response };
  }

  cancelTask(taskID: number, reason: string): boolean {
    const reject = this.pending.get(taskID);
    if (!reject) return false;
    this.pending.delete(taskID);
    this.cancelled.push({ taskID, reason });
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

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push(args.join(" ")),
    info: (...args) => lines.push(args.join(" ")),
    warn: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
  };
  return { logger, lines };
}

function neatWithWedgedWorker(): { neat: Neat; worker: WedgedWorker } {
  const worker = new WedgedWorker();
  const options: NeatOptions = { populationSize: 4 };
  const neat = new Neat(
    2,
    1,
    options,
    [worker as unknown as WorkerHandler],
  );
  return { neat, worker };
}

Deno.test("the watchdog cancels the in-flight training task it abandons (GRQ #4489)", async () => {
  const { neat, worker } = neatWithWedgedWorker();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const uuid = CreatureUtil.makeUUID(creature);

  neat.scheduleTraining(creature, 5);
  assertEquals(
    neat.trainingInProgress.size,
    1,
    "the task is dispatched to the wedged worker",
  );
  const inFlight = neat.trainingInProgress.get(uuid);
  assert(inFlight, "the training promise is tracked by uuid");

  // The task is now well past its per-task deadline plus grace.
  const deadline = neat.trainingDeadlines.get(uuid);
  assert(deadline !== undefined && deadline > 0, "a deadline was recorded");
  const abandoned = neat.abandonStuckTrainingTasks(deadline + 120_000, 30_000);
  assertEquals(abandoned, [uuid]);

  assertEquals(
    worker.cancelled.length,
    1,
    "abandoning the bookkeeping must also cancel the worker request",
  );
  assert(
    worker.cancelled[0].reason.includes(uuid.substring(uuid.length - 8)),
    `the cancellation names the task: ${worker.cancelled[0].reason}`,
  );

  // The promise settles — before the fix it stayed pending for the whole run.
  const settled = await Promise.race([
    inFlight.then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 250)),
  ]);
  assertEquals(settled, "settled", "an abandoned task must not stay pending");

  assertEquals(neat.trainingInProgress.size, 0);
  assertEquals(neat.trainingDeadlines.size, 0);
});

Deno.test("a worker that swallowed a training task is quarantined (GRQ #4489)", async () => {
  const { neat, worker } = neatWithWedgedWorker();
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const uuid = CreatureUtil.makeUUID(creature);

  neat.scheduleTraining(creature, 5);
  const inFlight = neat.trainingInProgress.get(uuid);
  assert(inFlight);
  const deadline = neat.trainingDeadlines.get(uuid) ?? 0;

  assert(worker.isHealthy(), "the worker starts healthy");
  neat.abandonStuckTrainingTasks(deadline + 120_000, 30_000);
  await inFlight;

  assertEquals(
    worker.isHealthy(),
    false,
    "a worker that never returned a result must not be given the next creature",
  );
  assert(
    worker.quarantinedFor?.includes(uuid.substring(uuid.length - 8)),
    `the quarantine names the task that wedged it: ${worker.quarantinedFor}`,
  );
});

Deno.test("an abandoned training task is reported with a per-task reason (GRQ #4489)", async () => {
  const { neat } = neatWithWedgedWorker();
  const creature = new Creature(2, 1, { layers: [{ count: 4 }] });
  const uuid = CreatureUtil.makeUUID(creature);
  const shortID = uuid.substring(uuid.length - 8);

  const { logger, lines } = makeRecordingLogger();
  const priorLogger = getLogger();
  setLogger(logger);
  try {
    neat.scheduleTraining(creature, 5);
    const inFlight = neat.trainingInProgress.get(uuid);
    assert(inFlight);
    const deadline = neat.trainingDeadlines.get(uuid) ?? 0;
    neat.abandonStuckTrainingTasks(deadline + 120_000, 30_000);
    await inFlight;
  } finally {
    setLogger(priorLogger);
  }

  const joined = lines.join("\n");
  assert(
    joined.includes(shortID),
    `the abandoned task is named in the log: ${joined}`,
  );
  assert(
    joined.includes("Training failed for creature"),
    `an abandoned task is reported as a failure, not silence: ${joined}`,
  );
});
