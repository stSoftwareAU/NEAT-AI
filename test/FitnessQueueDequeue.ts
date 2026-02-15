/**
 * Tests that Fitness.calculate() correctly evaluates all creatures when using
 * multiple workers with the work-stealing queue (Issue #1481).
 *
 * Verifies that replacing Array.shift() with an index-pointer approach
 * preserves correct behaviour: every unique creature is evaluated exactly
 * once and all scores are assigned.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Fitness } from "../src/architecture/Fitness.ts";
import type { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that tracks which creatures it evaluated.
 */
class MockQueueWorker {
  public evaluatedUUIDs: string[] = [];

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    const uuid = CreatureUtil.makeUUID(creature);
    this.evaluatedUUIDs.push(uuid);

    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 1));

    return { evaluate: { error: 0.05 } };
  }
}

/**
 * Creates a unique creature with a distinct bias value.
 */
function createUniqueCreature(index: number): Creature {
  const data: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: "TANH",
        bias: 0.1 + index * 0.01,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 + index * 0.01 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(data);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "Fitness.calculate - all unique creatures evaluated with multiple workers",
  async () => {
    const workers = [new MockQueueWorker(), new MockQueueWorker()];
    const fitness = new Fitness(
      workers as unknown as WorkerHandler[],
      0.0001,
      false,
    );

    const populationSize = 20;
    const population: Creature[] = [];
    for (let i = 0; i < populationSize; i++) {
      population.push(createUniqueCreature(i));
    }

    await fitness.calculate(population);

    // Every creature should have a score
    for (let i = 0; i < populationSize; i++) {
      assert(
        population[i].score !== undefined,
        `Creature ${i} should have a score`,
      );
    }

    // Total evaluations across all workers should equal population size
    const totalEvaluations = workers.reduce(
      (sum, w) => sum + w.evaluatedUUIDs.length,
      0,
    );
    assertEquals(
      totalEvaluations,
      populationSize,
      "Every unique creature should be evaluated exactly once",
    );

    // No UUID should be evaluated more than once across all workers
    const allEvaluated = workers.flatMap((w) => w.evaluatedUUIDs);
    const uniqueEvaluated = new Set(allEvaluated);
    assertEquals(
      uniqueEvaluated.size,
      populationSize,
      "No creature should be evaluated more than once",
    );
  },
);

Deno.test(
  "Fitness.calculate - empty population handled correctly",
  async () => {
    const worker = new MockQueueWorker();
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
    );

    await fitness.calculate([]);

    assertEquals(
      worker.evaluatedUUIDs.length,
      0,
      "No evaluations should occur for empty population",
    );
  },
);

Deno.test(
  "Fitness.calculate - single creature with multiple workers",
  async () => {
    const workers = [
      new MockQueueWorker(),
      new MockQueueWorker(),
      new MockQueueWorker(),
    ];
    const fitness = new Fitness(
      workers as unknown as WorkerHandler[],
      0.0001,
      false,
    );

    const population = [createUniqueCreature(0)];

    await fitness.calculate(population);

    assert(
      population[0].score !== undefined,
      "Single creature should have a score",
    );

    const totalEvaluations = workers.reduce(
      (sum, w) => sum + w.evaluatedUUIDs.length,
      0,
    );
    assertEquals(
      totalEvaluations,
      1,
      "Single creature should be evaluated exactly once",
    );
  },
);
