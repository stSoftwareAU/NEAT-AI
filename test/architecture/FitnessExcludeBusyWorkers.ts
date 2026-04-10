/**
 * Tests for excluding discovery/training-busy workers from fitness evaluation.
 *
 * Issue #2162: Workers running long-running tasks (discovery or training)
 * should be excluded from the active evaluation pool so that
 * Promise.all does not stall waiting for them.
 *
 * Verifies:
 * - Workers with active long tasks are excluded from evaluation
 * - Fallback to all workers when every worker is busy (no deadlock)
 * - Normal operation when no workers have long tasks
 * - Single-worker configurations still work correctly
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks evaluations and supports isRunningLongTask().
 */
class MockWorker {
  public evaluationCount = 0;
  public runningLongTask = false;

  isRunningLongTask(): boolean {
    return this.runningLongTask;
  }

  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluationCount++;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { evaluate: { error: 0.05 } };
  }
}

/** Create a simple creature for testing. */
function makeCreature(bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `hidden-${bias}`, squash: "TANH", bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `hidden-${bias}`, weight: 0.5 },
      { fromUUID: `hidden-${bias}`, toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(data);
}

Deno.test("Fitness excludes workers running long tasks from evaluation", async () => {
  const availableWorker = new MockWorker();
  const busyWorker = new MockWorker();
  busyWorker.runningLongTask = true;

  const fitness = new Fitness(
    [availableWorker, busyWorker] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.1), makeCreature(0.2), makeCreature(0.3)];

  await fitness.calculate(population);

  // The available worker should have handled all evaluations
  assertGreater(
    availableWorker.evaluationCount,
    0,
    "Available worker should have evaluated creatures",
  );
  assertEquals(
    busyWorker.evaluationCount,
    0,
    "Busy worker should not have evaluated any creatures",
  );
});

Deno.test("Fitness falls back to all workers when all are running long tasks", async () => {
  const worker1 = new MockWorker();
  const worker2 = new MockWorker();
  worker1.runningLongTask = true;
  worker2.runningLongTask = true;

  // Issue #2241: busyWorkerWaitMs: 0 disables bounded wait so this test
  // exercises the immediate fallback path without the polling delay.
  const fitness = new Fitness(
    [worker1, worker2] as unknown[] as WorkerHandler[],
    0.0001,
    false,
    {
      maxConcurrentEvaluations: 0,
      topologyGrouping: true,
      busyWorkerWaitMs: 0,
    },
  );

  const population = [makeCreature(0.1), makeCreature(0.2)];

  await fitness.calculate(population);

  // Both workers should have participated (fallback — no deadlock)
  const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
  assertEquals(
    totalEvaluations,
    2,
    "All creatures should be evaluated even when all workers are busy",
  );
});

Deno.test("Fitness uses all workers normally when none are running long tasks", async () => {
  const worker1 = new MockWorker();
  const worker2 = new MockWorker();

  const fitness = new Fitness(
    [worker1, worker2] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [
    makeCreature(0.1),
    makeCreature(0.2),
    makeCreature(0.3),
    makeCreature(0.4),
  ];

  await fitness.calculate(population);

  const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
  assertEquals(
    totalEvaluations,
    4,
    "All creatures should be evaluated across both workers",
  );
  // Both workers should have participated via work-stealing
  assertGreater(
    worker1.evaluationCount,
    0,
    "Worker 1 should have evaluated some creatures",
  );
  assertGreater(
    worker2.evaluationCount,
    0,
    "Worker 2 should have evaluated some creatures",
  );
});

Deno.test("Fitness works with single worker running long task (fallback)", async () => {
  const worker = new MockWorker();
  worker.runningLongTask = true;

  // Issue #2241: busyWorkerWaitMs: 0 disables bounded wait so this test
  // exercises the immediate fallback path without the polling delay.
  const fitness = new Fitness(
    [worker] as unknown[] as WorkerHandler[],
    0.0001,
    false,
    {
      maxConcurrentEvaluations: 0,
      topologyGrouping: true,
      busyWorkerWaitMs: 0,
    },
  );

  const population = [makeCreature(0.1), makeCreature(0.2)];

  await fitness.calculate(population);

  assertEquals(
    worker.evaluationCount,
    2,
    "Single busy worker should still evaluate all creatures (fallback)",
  );
});

Deno.test("Fitness works with single worker not running long task", async () => {
  const worker = new MockWorker();

  const fitness = new Fitness(
    [worker] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.1), makeCreature(0.2)];

  await fitness.calculate(population);

  assertEquals(
    worker.evaluationCount,
    2,
    "Single available worker should evaluate all creatures",
  );
});
