/**
 * Benchmark test to demonstrate the performance improvement from
 * fitness evaluation deduplication (Issue #1016).
 *
 * This test creates a population with many duplicate creatures and
 * measures how many evaluations are avoided through deduplication.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Fitness } from "../src/architecture/Fitness.ts";
import type { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker handler that counts evaluations for benchmarking.
 */
class BenchmarkWorkerHandler {
  public evaluateCallCount = 0;
  private busy = false;
  private idleListeners: (() => void)[] = [];

  addIdleListener(callback: () => void): void {
    this.idleListeners.push(callback);
  }

  isBusy(): boolean {
    return this.busy;
  }

  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.busy = true;
    this.evaluateCallCount++;

    // Simulate evaluation work
    await new Promise((resolve) => setTimeout(resolve, 1));

    this.busy = false;

    // Notify idle listeners
    for (const listener of this.idleListeners) {
      listener();
    }

    return { evaluate: { error: 0.1 } };
  }

  reset(): void {
    this.evaluateCallCount = 0;
  }
}

Deno.test("Fitness deduplication benchmark - measures evaluation savings", async () => {
  const mockWorker = new BenchmarkWorkerHandler();
  const fitness = new Fitness(
    [mockWorker as unknown as WorkerHandler],
    0.0001, // growth cost
    false, // feedbackLoop
  );

  // Create base creatures with different structures
  const baseCreatures: CreatureExport[] = [
    {
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
    },
    {
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.3 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.4 },
      ],
      input: 2,
      output: 1,
    },
    {
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: "RELU", bias: 0.1 },
        { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.2 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.3 },
        { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.4 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.6 },
      ],
      input: 2,
      output: 1,
    },
  ];

  // Create a large population with many duplicates
  // Simulating what might happen after crossover produces similar offspring
  const populationSize = 100;
  const uniqueCreatureCount = baseCreatures.length;
  const population: Creature[] = [];

  for (let i = 0; i < populationSize; i++) {
    // Cycle through base creatures to create duplicates
    const baseIndex = i % uniqueCreatureCount;
    population.push(Creature.fromJSON(baseCreatures[baseIndex]));
  }

  // Generate UUIDs for all creatures
  for (const creature of population) {
    CreatureUtil.makeUUID(creature);
  }

  // Calculate fitness (with deduplication)
  await fitness.calculate(population);

  // Verify deduplication worked
  assertEquals(
    mockWorker.evaluateCallCount,
    uniqueCreatureCount,
    `Should only evaluate ${uniqueCreatureCount} unique creatures, not ${populationSize}`,
  );

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  // Calculate savings
  const evaluationsSaved = populationSize - mockWorker.evaluateCallCount;
  const savingsPercent = ((evaluationsSaved / populationSize) * 100).toFixed(1);

  console.log(`\n--- Fitness Deduplication Benchmark Results ---`);
  console.log(`Population size: ${populationSize}`);
  console.log(`Unique creatures: ${uniqueCreatureCount}`);
  console.log(`Evaluations performed: ${mockWorker.evaluateCallCount}`);
  console.log(`Evaluations saved: ${evaluationsSaved}`);
  console.log(`Savings: ${savingsPercent}%`);
  console.log(`------------------------------------------------\n`);

  // Assert significant savings (should be ~97% in this test)
  assert(
    evaluationsSaved > populationSize * 0.9,
    `Expected at least 90% savings, got ${savingsPercent}%`,
  );
});
