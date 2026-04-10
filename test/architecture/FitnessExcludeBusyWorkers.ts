/**
 * Tests for fast-pool fitness evaluation (replaces busy-worker exclusion tests).
 *
 * Issue #2245: The reactive `isRunningLongTask()` filtering has been replaced
 * by a structural fix — fitness evaluation now only receives fast-pool workers
 * that are dedicated to evaluation and never run discovery or training.
 *
 * BUSINESS LOGIC CHANGE: These tests previously verified that Fitness
 * dynamically excluded workers running long tasks (Issue #2162). That
 * filtering logic has been removed because the fast-pool architecture
 * makes it unnecessary. Tests now verify that Fitness works correctly
 * with its dedicated worker pool.
 *
 * Verifies:
 * - Fitness uses all provided (fast-pool) workers for evaluation
 * - Single-worker configurations work correctly
 * - All creatures receive scores after evaluation
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
 * no longer calls it — fast-pool workers are always available.
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

Deno.test("Fitness uses all fast-pool workers for evaluation", async () => {
  const worker1 = new MockWorker();
  const worker2 = new MockWorker();

  // Issue #2245: Fitness receives only fast-pool workers
  const fitness = new Fitness(
    [worker1, worker2] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.1), makeCreature(0.2), makeCreature(0.3)];

  await fitness.calculate(population);

  // Both workers should have participated
  const totalEvaluations = worker1.evaluationCount + worker2.evaluationCount;
  assertEquals(
    totalEvaluations,
    3,
    "All creatures should be evaluated across fast-pool workers",
  );
  assertGreater(
    worker1.evaluationCount,
    0,
    "Worker 1 should have evaluated some creatures",
  );
});

Deno.test("Fitness distributes work across all fast-pool workers", async () => {
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

Deno.test("Fitness works with single fast-pool worker", async () => {
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
    "Single fast-pool worker should evaluate all creatures",
  );
});

Deno.test("Fitness assigns scores to all creatures after evaluation", async () => {
  const worker = new MockWorker();

  const fitness = new Fitness(
    [worker] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.1), makeCreature(0.2), makeCreature(0.3)];

  await fitness.calculate(population);

  for (const creature of population) {
    assert(
      creature.score !== undefined && typeof creature.score === "number",
      "Every creature should have a numeric score after evaluation",
    );
  }
});
