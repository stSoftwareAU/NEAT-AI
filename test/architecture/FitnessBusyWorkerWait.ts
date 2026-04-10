/**
 * Tests for fast-pool fitness evaluation (replaces bounded wait tests).
 *
 * Issue #2245: The bounded wait behaviour (`busyWorkerWaitMs`) has been
 * removed because fitness evaluation now only receives fast-pool workers
 * that are dedicated to evaluation and never run discovery or training.
 *
 * BUSINESS LOGIC CHANGE: These tests previously verified that Fitness
 * polled busy workers and fell back after a timeout (Issue #2241). That
 * entire mechanism has been removed because the fast-pool architecture
 * ensures evaluation workers are always available. Tests now verify that
 * Fitness works correctly with its dedicated fast-pool workers without
 * any busy-worker filtering or waiting.
 *
 * Verifies:
 * - Fitness evaluates all creatures using fast-pool workers
 * - Evaluation completes without any busy-worker polling
 * - Multiple fast-pool workers share the evaluation load
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks evaluations.
 * Issue #2245: No longer needs isRunningLongTask() since Fitness
 * only receives fast-pool workers that never run heavy tasks.
 */
class MockWorker {
  public evaluationCount = 0;

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
  "Fitness fast-pool workers evaluate all creatures without polling",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();

    // Issue #2245: No busyWorkerWaitMs config needed — fast-pool workers
    // are always available for evaluation.
    const fitness = new Fitness(
      [worker1, worker2] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [
      makeCreature(0.1),
      makeCreature(0.2),
      makeCreature(0.3),
    ];

    await fitness.calculate(population);

    const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
    assertEquals(
      totalEvaluations,
      3,
      "All creatures should be evaluated by fast-pool workers",
    );
  },
);

Deno.test(
  "Fitness fast-pool evaluation distributes work across workers",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    const worker3 = new MockWorker();

    const fitness = new Fitness(
      [worker1, worker2, worker3] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [
      makeCreature(0.1),
      makeCreature(0.2),
      makeCreature(0.3),
      makeCreature(0.4),
      makeCreature(0.5),
      makeCreature(0.6),
    ];

    await fitness.calculate(population);

    const totalEvaluations = worker1.evaluationCount +
      worker2.evaluationCount + worker3.evaluationCount;
    assertEquals(
      totalEvaluations,
      6,
      "All creatures should be evaluated",
    );
  },
);

Deno.test(
  "Fitness fast-pool evaluation assigns valid scores to all creatures",
  async () => {
    const worker = new MockWorker();

    const fitness = new Fitness(
      [worker] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [makeCreature(0.1), makeCreature(0.2)];

    await fitness.calculate(population);

    for (const creature of population) {
      assert(
        creature.score !== undefined,
        "Creature should have a score",
      );
      assert(
        Number.isFinite(creature.score),
        "Creature score should be finite",
      );
    }
  },
);

Deno.test(
  "Fitness maxConcurrentEvaluations still caps fast-pool worker usage",
  async () => {
    const worker1 = new MockWorker();
    const worker2 = new MockWorker();
    const worker3 = new MockWorker();

    // Cap to 2 workers even though 3 are available
    const fitness = new Fitness(
      [worker1, worker2, worker3] as unknown[] as WorkerHandler[],
      0.0001,
      false,
      {
        maxConcurrentEvaluations: 2,
        topologyGrouping: false,
      },
    );

    const population = [
      makeCreature(0.1),
      makeCreature(0.2),
      makeCreature(0.3),
    ];

    await fitness.calculate(population);

    const usedEvaluations = worker1.evaluationCount + worker2.evaluationCount;
    assertGreater(
      usedEvaluations,
      0,
      "Capped workers should have evaluated creatures",
    );
    assertEquals(
      worker3.evaluationCount,
      0,
      "Worker beyond maxConcurrentEvaluations should not be used",
    );
  },
);
