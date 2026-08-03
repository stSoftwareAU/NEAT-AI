/**
 * Tests for dynamic worker pool — idle heavy workers assisting fitness
 * evaluation (Issue #2313).
 *
 * When heavy workers have no pending discovery or training tasks, they
 * should be available to assist with fitness evaluation. This test
 * verifies that `additionalWorkers` passed to `Fitness.calculate()`
 * participate in creature evaluation alongside the regular fast-pool
 * workers.
 *
 * BUSINESS LOGIC CHANGE (Issue #3566): a test here asserted that
 * `maxConcurrentEvaluations: 2` excluded the assisting heavy worker. The
 * option has been removed — it defaulted to 0 (no cap) and no consumer set
 * it — so that test went with it; every supplied worker now participates.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks how many evaluations it performs.
 */
class MockWorker {
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
  "Fitness.calculate uses additional workers alongside fast-pool workers",
  async () => {
    const fastWorker1 = new MockWorker("fast-1");
    const fastWorker2 = new MockWorker("fast-2");
    const heavyWorker = new MockWorker("heavy-idle");

    const fitness = new Fitness(
      [fastWorker1, fastWorker2] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    // 6 creatures: with 3 workers (2 fast + 1 idle heavy) each should
    // pick up roughly 2 creatures via work-stealing.
    const population = [
      makeCreature(0.1),
      makeCreature(0.2),
      makeCreature(0.3),
      makeCreature(0.4),
      makeCreature(0.5),
      makeCreature(0.6),
    ];

    // Pass the idle heavy worker as an additional worker
    await fitness.calculate(
      population,
      [heavyWorker] as unknown[] as WorkerHandler[],
    );

    const totalEvaluations = fastWorker1.evaluationCount +
      fastWorker2.evaluationCount +
      heavyWorker.evaluationCount;

    assertEquals(
      totalEvaluations,
      6,
      "All 6 creatures should be evaluated across all 3 workers",
    );

    // The idle heavy worker should have participated
    assertGreater(
      heavyWorker.evaluationCount,
      0,
      "Idle heavy worker should have evaluated at least one creature",
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
  "Fitness.calculate works normally when no additional workers provided",
  async () => {
    const fastWorker = new MockWorker("fast-1");

    const fitness = new Fitness(
      [fastWorker] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [makeCreature(0.1), makeCreature(0.2)];

    // No additional workers — should work exactly as before
    await fitness.calculate(population);

    assertEquals(
      fastWorker.evaluationCount,
      2,
      "All creatures should be evaluated by the fast worker",
    );
  },
);

Deno.test(
  "Fitness.calculate works normally with empty additional workers array",
  async () => {
    const fastWorker = new MockWorker("fast-1");

    const fitness = new Fitness(
      [fastWorker] as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [makeCreature(0.1), makeCreature(0.2)];

    // Empty additional workers — should behave the same as no argument
    await fitness.calculate(population, []);

    assertEquals(
      fastWorker.evaluationCount,
      2,
      "All creatures should be evaluated by the fast worker",
    );
  },
);
