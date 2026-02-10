/**
 * Test suite for parallel fitness evaluation (Issue #1289).
 *
 * Verifies that fitness evaluation distributes creature evaluations
 * across multiple workers using a work-stealing pattern, rather than
 * the reactive idle-listener approach.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Fitness } from "../../src/architecture/Fitness.ts";
import type { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker handler that tracks evaluation calls and supports
 * concurrent evaluation tracking across multiple workers.
 *
 * Issue #1289: Extended to track maximum concurrent evaluations
 * for verifying parallel dispatch behaviour.
 */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  private busyCount = 0;
  private idleListeners: ((worker: MockWorkerHandler) => void)[] = [];
  private evaluatedCreatures: Map<string, number> = new Map();
  /** Peak number of concurrent evaluations observed on this worker */
  public peakConcurrentEvaluations = 0;

  addIdleListener(callback: (worker: MockWorkerHandler) => void): void {
    this.idleListeners.push(callback);
  }

  isBusy(): boolean {
    return this.busyCount > 0;
  }

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.busyCount++;
    this.evaluateCallCount++;
    if (this.busyCount > this.peakConcurrentEvaluations) {
      this.peakConcurrentEvaluations = this.busyCount;
    }

    const uuid = CreatureUtil.makeUUID(creature);
    const currentCount = this.evaluatedCreatures.get(uuid) || 0;
    this.evaluatedCreatures.set(uuid, currentCount + 1);

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 1));

    this.busyCount--;

    // Notify idle listeners
    if (this.busyCount === 0) {
      for (const listener of this.idleListeners) {
        listener(this);
      }
    }

    // Return a deterministic error based on creature structure
    const error = 0.1;
    return { evaluate: { error } };
  }

  getEvaluationCountForUUID(uuid: string): number {
    return this.evaluatedCreatures.get(uuid) || 0;
  }

  reset(): void {
    this.evaluateCallCount = 0;
    this.evaluatedCreatures.clear();
    this.peakConcurrentEvaluations = 0;
  }
}

/**
 * Helper to create a population of unique creatures with different weights.
 */
function createUniquePopulation(size: number): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: "TANH",
          bias: 0.1 + i * 0.01,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-0",
          weight: 0.5 + i * 0.1,
        },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}

Deno.test("Fitness - distributes evaluations across multiple workers", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();
  const worker3 = new MockWorkerHandler();

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
      worker3 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
  );

  // Create a population of 9 unique creatures
  const population = createUniquePopulation(9);

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
    assert(Number.isFinite(creature.score), "Scores should be finite");
  }

  // Total evaluations across all workers should equal population size
  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount +
    worker3.evaluateCallCount;
  assertEquals(
    totalEvaluations,
    9,
    "Total evaluations should equal population size",
  );

  // Work should be distributed - at least 2 workers should have been used
  const workersUsed = [worker1, worker2, worker3].filter(
    (w) => w.evaluateCallCount > 0,
  ).length;
  assert(
    workersUsed >= 2,
    `Work should be distributed across workers (${workersUsed} workers used)`,
  );
});

Deno.test("Fitness - parallel evaluation preserves deduplication", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
  );

  const baseCreature: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };

  // Create 4 identical creatures (same UUID) and 2 unique ones
  const identicalA = Creature.fromJSON(baseCreature);
  const identicalB = Creature.fromJSON(baseCreature);
  const identicalC = Creature.fromJSON(baseCreature);
  const identicalD = Creature.fromJSON(baseCreature);

  const uniqueCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.9 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const population = [
    identicalA,
    identicalB,
    uniqueCreature,
    identicalC,
    identicalD,
  ];
  for (const c of population) {
    CreatureUtil.makeUUID(c);
  }

  await fitness.calculate(population);

  // Only 2 unique creatures should be evaluated
  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount;
  assertEquals(
    totalEvaluations,
    2,
    "Should only evaluate unique creatures",
  );

  // All identical creatures should have the same score
  assertEquals(identicalA.score, identicalB.score);
  assertEquals(identicalB.score, identicalC.score);
  assertEquals(identicalC.score, identicalD.score);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }
});

Deno.test("Fitness - handles single worker correctly", async () => {
  const worker = new MockWorkerHandler();

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
  );

  const population = createUniquePopulation(5);

  await fitness.calculate(population);

  // All evaluations should go to the single worker
  assertEquals(
    worker.evaluateCallCount,
    5,
    "Single worker should handle all evaluations",
  );

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }
});

Deno.test("Fitness - empty population completes immediately", async () => {
  const worker = new MockWorkerHandler();

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
  );

  const population: Creature[] = [];

  await fitness.calculate(population);

  assertEquals(
    worker.evaluateCallCount,
    0,
    "No evaluations should occur for empty population",
  );
});

Deno.test("Fitness - all pre-scored creatures skip evaluation", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
  );

  const population = createUniquePopulation(3);
  // Pre-set scores on all creatures
  for (const creature of population) {
    creature.score = 0.9;
  }

  await fitness.calculate(population);

  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount;
  assertEquals(
    totalEvaluations,
    0,
    "No evaluations should occur when all creatures have scores",
  );
});

Deno.test("Fitness - large population distributed across many workers", async () => {
  const workerCount = 4;
  const workers: MockWorkerHandler[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(new MockWorkerHandler());
  }

  const fitness = new Fitness(
    workers.map((w) => w as unknown as WorkerHandler),
    0.0001,
    false,
  );

  // Create a larger population
  const populationSize = 20;
  const population = createUniquePopulation(populationSize);

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  // Total evaluations should match population size
  const totalEvaluations = workers.reduce(
    (sum, w) => sum + w.evaluateCallCount,
    0,
  );
  assertEquals(
    totalEvaluations,
    populationSize,
    "Total evaluations should equal population size",
  );

  // Work should be distributed - at least 3 of 4 workers should have been used
  const workersUsed = workers.filter((w) => w.evaluateCallCount > 0).length;
  assert(
    workersUsed >= 3,
    `Work should be distributed across workers (${workersUsed} of ${workerCount} used)`,
  );
});

Deno.test("Fitness - mixed scored and unscored creatures", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
  );

  const population = createUniquePopulation(6);
  // Pre-score half the population
  population[0].score = 0.9;
  population[2].score = 0.8;
  population[4].score = 0.7;

  await fitness.calculate(population);

  // Only unscored creatures should be evaluated
  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount;
  assertEquals(
    totalEvaluations,
    3,
    "Should only evaluate unscored creatures",
  );

  // Pre-scored creatures should keep their scores
  assertEquals(
    population[0].score,
    0.9,
    "Pre-scored creature should keep score",
  );
  assertEquals(
    population[2].score,
    0.8,
    "Pre-scored creature should keep score",
  );
  assertEquals(
    population[4].score,
    0.7,
    "Pre-scored creature should keep score",
  );

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }
});
