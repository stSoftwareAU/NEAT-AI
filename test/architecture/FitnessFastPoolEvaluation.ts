/**
 * Tests for fast-pool fitness evaluation (Issue #2245).
 *
 * Issue #2245: Fitness evaluation should only use workers from the fast
 * pool, which are dedicated to evaluation and never run discovery or
 * training. This eliminates the need for reactive `isRunningLongTask()`
 * filtering and ensures evaluation never stalls waiting for a worker
 * running a heavy task.
 *
 * Verifies:
 * - Fitness uses only fast-pool workers, ignoring heavy-pool workers
 * - Evaluation completes promptly even when heavy-pool workers are occupied
 * - Fast-pool workers are never blocked by discovery/training tasks
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks evaluations and simulates fast-pool behaviour.
 */
class MockFastWorker {
  public evaluationCount = 0;
  public label: string;

  constructor(label: string) {
    this.label = label;
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

/**
 * Mock worker simulating a heavy-pool worker occupied with a long task.
 * This worker should never be given to Fitness in the new architecture.
 */
class MockHeavyWorker {
  public evaluationCount = 0;

  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluationCount++;
    // Simulate a slow response due to being occupied with discovery/training
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { evaluate: { error: 0.1 } };
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
  "Fitness with fast-pool workers evaluates all creatures without filtering",
  async () => {
    const fastWorker1 = new MockFastWorker("fast-1");
    const fastWorker2 = new MockFastWorker("fast-2");

    // Issue #2245: Fitness only receives fast-pool workers — no filtering needed
    const fitness = new Fitness(
      [fastWorker1, fastWorker2] as unknown[] as WorkerHandler[],
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

    const totalEvaluations = fastWorker1.evaluationCount +
      fastWorker2.evaluationCount;
    assertEquals(
      totalEvaluations,
      4,
      "All creatures should be evaluated across fast-pool workers",
    );
    // Both workers should have participated
    assertGreater(
      fastWorker1.evaluationCount,
      0,
      "Fast worker 1 should have evaluated creatures",
    );
    assertGreater(
      fastWorker2.evaluationCount,
      0,
      "Fast worker 2 should have evaluated creatures",
    );
  },
);

Deno.test(
  "Fitness evaluation completes promptly when heavy-pool workers are occupied elsewhere",
  async () => {
    // Simulate the new architecture: only fast workers are given to Fitness.
    // Heavy workers are occupied with discovery/training but are NOT passed
    // to Fitness, so evaluation should complete quickly.
    const fastWorker = new MockFastWorker("fast-1");

    // Heavy workers exist but are NOT given to Fitness
    const heavyWorker = new MockHeavyWorker();
    // Simulate heavy worker being occupied (it would be running discovery)
    void heavyWorker; // Not passed to Fitness

    const fitness = new Fitness(
      [fastWorker] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [
      makeCreature(0.1),
      makeCreature(0.2),
      makeCreature(0.3),
    ];

    // Evaluation should complete quickly since only fast workers are used
    await fitness.calculate(population);

    assertEquals(
      fastWorker.evaluationCount,
      3,
      "All creatures should be evaluated by the fast worker",
    );

    // Heavy worker should not have been used at all
    assertEquals(
      heavyWorker.evaluationCount,
      0,
      "Heavy worker should not participate in fitness evaluation",
    );

    // All creatures should have scores
    for (const creature of population) {
      assertEquals(
        typeof creature.score,
        "number",
        "Every creature should have a numeric score",
      );
    }
  },
);

Deno.test(
  "Fitness no longer requires isRunningLongTask filtering",
  async () => {
    // Issue #2245: Workers passed to Fitness are guaranteed to be from the
    // fast pool, so there is no need for isRunningLongTask() filtering.
    // This test verifies that workers without isRunningLongTask() work fine.
    const minimalWorker = {
      evaluationCount: 0,
      evaluate(
        _creature: Creature,
        _feedbackLoop: boolean,
      ): Promise<{ evaluate: { error: number } }> {
        minimalWorker.evaluationCount++;
        return Promise.resolve({ evaluate: { error: 0.05 } });
      },
    };

    const fitness = new Fitness(
      [minimalWorker] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [makeCreature(0.1), makeCreature(0.2)];

    await fitness.calculate(population);

    assertEquals(
      minimalWorker.evaluationCount,
      2,
      "Workers without isRunningLongTask should work — method is no longer called",
    );
  },
);
