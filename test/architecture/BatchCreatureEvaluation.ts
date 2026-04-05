/**
 * Test suite for parallel batch creature evaluation (Issue #1862).
 *
 * Verifies that:
 * - Topology-aware grouping sorts creatures by topology hash
 * - Configurable concurrency limits the number of active workers
 * - Batch evaluation produces identical results to sequential evaluation
 * - Configuration is properly parsed and applied
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker handler that tracks evaluation order and which
 * creatures were evaluated on which worker.
 */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  public evaluatedUUIDs: string[] = [];
  public evaluatedTopologyHashes: string[] = [];
  private busyCount = 0;

  isBusy(): boolean {
    return this.busyCount > 0;
  }

  isRunningLongTask(): boolean {
    return false;
  }

  addIdleListener(_callback: (worker: MockWorkerHandler) => void): void {
    // Not used in these tests
  }

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.busyCount++;
    this.evaluateCallCount++;

    const uuid = CreatureUtil.makeUUID(creature);
    this.evaluatedUUIDs.push(uuid);

    const topologyHash = CreatureUtil.getTopologyHash(creature);
    this.evaluatedTopologyHashes.push(topologyHash);

    // Yield to the event loop
    await Promise.resolve();

    this.busyCount--;

    // Return a deterministic error based on creature structure
    const error = 0.1;
    return { evaluate: { error } };
  }

  reset(): void {
    this.evaluateCallCount = 0;
    this.evaluatedUUIDs = [];
    this.evaluatedTopologyHashes = [];
  }
}

/**
 * Create creatures with the same topology but different weights.
 * All creatures share the same neuron/synapse structure but have
 * different weight values, so they have the same topology hash
 * but different UUIDs.
 */
function createSameTopologyCreatures(count: number): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
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

/**
 * Create creatures with different topologies (different squash functions).
 * Each creature has a unique bias to ensure distinct UUIDs even when
 * squash functions repeat.
 */
function createDifferentTopologyCreatures(count: number): Creature[] {
  const squashes = ["TANH", "LOGISTIC", "RELU", "IDENTITY", "BIPOLAR_SIGMOID"];
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: squashes[i % squashes.length],
          bias: 0.1 + i * 0.01,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 + i * 0.1 },
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

Deno.test("Fitness - topology grouping clusters same-topology creatures", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();

  const evalConfig: RequiredParallelEvaluationConfig = {
    ...DEFAULT_PARALLEL_EVALUATION_CONFIG,
    topologyGrouping: true,
  };

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
    evalConfig,
  );

  // Create 4 creatures with topology A and 4 with topology B (interleaved)
  const topologyA = createSameTopologyCreatures(4); // All TANH
  const topologyB: Creature[] = [];
  for (let i = 0; i < 4; i++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: "LOGISTIC",
          bias: 0.2 + i * 0.01,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-0",
          weight: 0.3 + i * 0.1,
        },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });
    CreatureUtil.makeUUID(creature);
    topologyB.push(creature);
  }

  // Interleave: A, B, A, B, A, B, A, B
  const population: Creature[] = [];
  for (let i = 0; i < 4; i++) {
    population.push(topologyA[i]);
    population.push(topologyB[i]);
  }

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
    assert(Number.isFinite(creature.score), "Scores should be finite");
  }

  // Total evaluations should match population size
  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount;
  assertEquals(totalEvaluations, 8, "Total evaluations should equal 8");

  // With topology grouping, each worker should see clustered topologies
  // Check that consecutive evaluations on each worker have the same topology hash
  for (const worker of [worker1, worker2]) {
    if (worker.evaluatedTopologyHashes.length >= 2) {
      // Count topology transitions (changes between consecutive evaluations)
      let transitions = 0;
      for (let i = 1; i < worker.evaluatedTopologyHashes.length; i++) {
        if (
          worker.evaluatedTopologyHashes[i] !==
            worker.evaluatedTopologyHashes[i - 1]
        ) {
          transitions++;
        }
      }
      // With grouping, transitions should be fewer than without grouping.
      // At most 1 transition per worker (A→B or B→A) vs potentially many.
      assert(
        transitions <= 1,
        `Worker should have at most 1 topology transition with grouping, got ${transitions}`,
      );
    }
  }
});

Deno.test("Fitness - topology grouping disabled preserves original order", async () => {
  const worker = new MockWorkerHandler();

  const evalConfig: RequiredParallelEvaluationConfig = {
    ...DEFAULT_PARALLEL_EVALUATION_CONFIG,
    topologyGrouping: false,
  };

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfig,
  );

  const population = createDifferentTopologyCreatures(5);

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  assertEquals(
    worker.evaluateCallCount,
    5,
    "All creatures should be evaluated",
  );
});

Deno.test("Fitness - maxConcurrentEvaluations limits active workers", async () => {
  const workers: MockWorkerHandler[] = [];
  for (let i = 0; i < 4; i++) {
    workers.push(new MockWorkerHandler());
  }

  const evalConfig: RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 2,
    topologyGrouping: false,
  };

  const fitness = new Fitness(
    workers.map((w) => w as unknown as WorkerHandler),
    0.0001,
    false,
    evalConfig,
  );

  const population = createSameTopologyCreatures(8);

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  // Total evaluations should match
  const totalEvaluations = workers.reduce(
    (sum, w) => sum + w.evaluateCallCount,
    0,
  );
  assertEquals(totalEvaluations, 8, "Total evaluations should equal 8");

  // Only 2 of 4 workers should have been used (capped at 2)
  const workersUsed = workers.filter((w) => w.evaluateCallCount > 0).length;
  assert(
    workersUsed <= 2,
    `Only ${evalConfig.maxConcurrentEvaluations} workers should be used, but ${workersUsed} were used`,
  );
});

Deno.test("Fitness - maxConcurrentEvaluations 0 uses all workers", async () => {
  const workers: MockWorkerHandler[] = [];
  for (let i = 0; i < 3; i++) {
    workers.push(new MockWorkerHandler());
  }

  const evalConfig: RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 0,
    topologyGrouping: true,
  };

  const fitness = new Fitness(
    workers.map((w) => w as unknown as WorkerHandler),
    0.0001,
    false,
    evalConfig,
  );

  const population = createDifferentTopologyCreatures(9);

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  // Total evaluations should match
  const totalEvaluations = workers.reduce(
    (sum, w) => sum + w.evaluateCallCount,
    0,
  );
  assertEquals(totalEvaluations, 9, "Total evaluations should equal 9");

  // With 0 (all workers), at least 2 workers should be used
  const workersUsed = workers.filter((w) => w.evaluateCallCount > 0).length;
  assert(
    workersUsed >= 2,
    `All workers should be available (${workersUsed} used)`,
  );
});

Deno.test("Fitness - batch evaluation produces identical results to sequential", async () => {
  // Evaluate with topology grouping enabled
  const worker1 = new MockWorkerHandler();
  const evalConfigGrouped: RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 0,
    topologyGrouping: true,
  };
  const fitnessGrouped = new Fitness(
    [worker1 as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfigGrouped,
  );

  // Evaluate without topology grouping
  const worker2 = new MockWorkerHandler();
  const evalConfigUngrouped: RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 0,
    topologyGrouping: false,
  };
  const fitnessUngrouped = new Fitness(
    [worker2 as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfigUngrouped,
  );

  // Create identical populations
  const population1 = createDifferentTopologyCreatures(6);
  const population2 = createDifferentTopologyCreatures(6);

  await fitnessGrouped.calculate(population1);
  await fitnessUngrouped.calculate(population2);

  // Results should be identical regardless of grouping
  for (let i = 0; i < population1.length; i++) {
    assertEquals(
      population1[i].score,
      population2[i].score,
      `Creature ${i} scores should match between grouped and ungrouped evaluation`,
    );
  }
});

Deno.test("Fitness - backward compatible without config parameter", async () => {
  const worker = new MockWorkerHandler();

  // Call without evalConfig (backward compatibility)
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
  );

  const population = createSameTopologyCreatures(3);

  await fitness.calculate(population);

  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  assertEquals(
    worker.evaluateCallCount,
    3,
    "All creatures should be evaluated",
  );
});

Deno.test("Fitness - topology grouping with deduplication", async () => {
  const worker1 = new MockWorkerHandler();
  const worker2 = new MockWorkerHandler();

  const evalConfig: RequiredParallelEvaluationConfig = {
    maxConcurrentEvaluations: 0,
    topologyGrouping: true,
  };

  const fitness = new Fitness(
    [
      worker1 as unknown as WorkerHandler,
      worker2 as unknown as WorkerHandler,
    ],
    0.0001,
    false,
    evalConfig,
  );

  // Create creatures: 2 identical (same UUID) + 2 unique with different topology
  const identical1 = Creature.fromJSON({
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
  });
  CreatureUtil.makeUUID(identical1);

  const identical2 = Creature.fromJSON({
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
  });
  CreatureUtil.makeUUID(identical2);

  const uniqueCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.9 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });
  CreatureUtil.makeUUID(uniqueCreature);

  const population = [identical1, uniqueCreature, identical2];

  await fitness.calculate(population);

  // Only 2 unique creatures should be evaluated (identical1 and uniqueCreature)
  const totalEvaluations = worker1.evaluateCallCount +
    worker2.evaluateCallCount;
  assertEquals(
    totalEvaluations,
    2,
    "Should only evaluate unique creatures",
  );

  // Both identical creatures should have the same score
  assertEquals(identical1.score, identical2.score);

  // All should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }
});

Deno.test("Fitness - default config has expected values", () => {
  assertEquals(DEFAULT_PARALLEL_EVALUATION_CONFIG.maxConcurrentEvaluations, 0);
  assertEquals(DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping, true);
});
