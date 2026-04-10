/**
 * Tests for the bounded wait behaviour when all workers are running
 * long tasks during fitness evaluation.
 *
 * Issue #2241: When every worker is occupied with a long-running task
 * (discovery/training), the fitness evaluator should wait briefly for
 * a worker to become free before falling back to using all workers.
 * This prevents Promise.all from stalling on workers mid-task.
 *
 * Verifies:
 * - Bounded wait uses a worker that becomes free during the wait
 * - Bounded wait falls back after the timeout expires
 * - Bounded wait is disabled when busyWorkerWaitMs is 0
 * - Informational logging emits the worker availability ratio
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { type Logger, setLogger } from "@utils/Logger.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks evaluations and supports transitioning
 * from a long-running state to idle during a bounded wait.
 */
class MockWorker {
  public evaluationCount = 0;
  public runningLongTask = false;

  isRunningLongTask(): boolean {
    return this.runningLongTask;
  }

  isBusy(): boolean {
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

Deno.test(
  "Fitness bounded wait uses worker that becomes free during wait",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    worker1.runningLongTask = true;
    worker2.runningLongTask = true;

    // Worker1 finishes its long task after 200ms
    const timer = setTimeout(() => {
      worker1.runningLongTask = false;
    }, 200);

    try {
      const fitness = new Fitness(
        [worker1, worker2] as unknown[] as WorkerHandler[],
        0.0001,
        false,
        {
          maxConcurrentEvaluations: 0,
          topologyGrouping: true,
          busyWorkerWaitMs: 5_000,
        },
      );

      const population = [
        makeCreature(0.1),
        makeCreature(0.2),
        makeCreature(0.3),
      ];

      await fitness.calculate(population);

      // Worker1 became free during the wait, so it should handle evaluations
      assertGreater(
        worker1.evaluationCount,
        0,
        "Worker that became free should have evaluated creatures",
      );
      // Worker2 stayed busy, so it should not have been selected
      assertEquals(
        worker2.evaluationCount,
        0,
        "Worker still running long task should not evaluate",
      );
    } finally {
      clearTimeout(timer);
    }
  },
);

Deno.test(
  "Fitness bounded wait falls back to all workers after timeout",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    worker1.runningLongTask = true;
    worker2.runningLongTask = true;

    // Neither worker becomes free within the timeout

    const fitness = new Fitness(
      [worker1, worker2] as unknown[] as WorkerHandler[],
      0.0001,
      false,
      {
        maxConcurrentEvaluations: 0,
        topologyGrouping: true,
        busyWorkerWaitMs: 200, // Short timeout so test is fast
      },
    );

    const population = [makeCreature(0.1), makeCreature(0.2)];

    await fitness.calculate(population);

    // After timeout, both workers should be used as fallback
    const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
    assertEquals(
      totalEvaluations,
      2,
      "All creatures should be evaluated after timeout fallback",
    );
  },
);

Deno.test(
  "Fitness bounded wait disabled when busyWorkerWaitMs is zero",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    worker1.runningLongTask = true;
    worker2.runningLongTask = true;

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

    // Immediate fallback — all workers used without waiting
    const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
    assertEquals(
      totalEvaluations,
      2,
      "All creatures should be evaluated with immediate fallback",
    );
  },
);

Deno.test(
  "Fitness logs worker availability ratio at info level",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    const worker3 = new MockWorker();
    worker2.runningLongTask = true;
    worker3.runningLongTask = true;

    const infoMessages: string[] = [];
    const capturingLogger: Logger = {
      debug() {},
      info(...args: unknown[]) {
        infoMessages.push(args.map(String).join(" "));
      },
      warn() {},
      error() {},
    };

    setLogger(capturingLogger);

    try {
      const fitness = new Fitness(
        [worker1, worker2, worker3] as unknown[] as WorkerHandler[],
        0.0001,
        false,
        {
          maxConcurrentEvaluations: 0,
          topologyGrouping: true,
          busyWorkerWaitMs: 0,
        },
      );

      const population = [makeCreature(0.1)];
      await fitness.calculate(population);

      // Verify that an informational log was emitted with worker availability
      const availabilityLog = infoMessages.find(
        (msg) => msg.includes("Fitness:") && msg.includes("worker"),
      );
      assertGreater(
        availabilityLog?.length ?? 0,
        0,
        "Expected an info-level log message showing worker availability",
      );
    } finally {
      // Restore default logger
      const { createConsoleLogger } = await import("@utils/Logger.ts");
      setLogger(createConsoleLogger("info"));
    }
  },
);
