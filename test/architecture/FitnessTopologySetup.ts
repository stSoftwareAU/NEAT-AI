/**
 * Tests for fitness evaluation queue setup optimisation (Issue #2043).
 *
 * Verifies that:
 * - Topology grouping produces correctly grouped evaluation order
 * - Disabling topology grouping still evaluates all creatures correctly
 * - Scores are assigned correctly in both modes
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Fitness } from "../../src/architecture/Fitness.ts";
import type { RequiredParallelEvaluationConfig } from "../../src/config/ParallelEvaluationConfig.ts";
import type { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that records the order of evaluated creatures.
 */
class OrderTrackingWorker {
  public evaluationOrder: Creature[] = [];

  addIdleListener(_callback: unknown): void {
    // Not used
  }

  isBusy(): boolean {
    return false;
  }

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluationOrder.push(creature);
    await Promise.resolve();
    return { evaluate: { error: 0.1 } };
  }
}

function createCreature(squash: string, bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash, bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(data);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("Fitness — topology grouping clusters same-topology creatures", async () => {
  const worker = new OrderTrackingWorker();
  const config: RequiredParallelEvaluationConfig = {
    topologyGrouping: true,
    maxConcurrentEvaluations: 0,
  };
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    config,
  );

  // Create creatures with different topologies (different squash = different hash)
  // Interleave them so they're not already grouped
  const tanhA = createCreature("TANH", 0.1);
  const logisticA = createCreature("LOGISTIC", 0.2);
  const tanhB = createCreature("TANH", 0.3);
  const logisticB = createCreature("LOGISTIC", 0.4);
  const reluA = createCreature("RELU", 0.5);

  const population = [tanhA, logisticA, tanhB, logisticB, reluA];

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "Every creature should have a score");
  }

  // With topology grouping, same-topology creatures should be adjacent
  // in the evaluation order
  const order = worker.evaluationOrder;
  assertEquals(order.length, 5, "All 5 unique creatures should be evaluated");

  // Group the evaluation order by topology hash
  const seenHashes: string[] = [];
  for (const creature of order) {
    const hash = CreatureUtil.getTopologyHash(creature);
    if (seenHashes.length === 0 || seenHashes[seenHashes.length - 1] !== hash) {
      seenHashes.push(hash);
    }
  }

  // Each unique topology should appear as a contiguous block
  const uniqueHashes = new Set(
    order.map((c) => CreatureUtil.getTopologyHash(c)),
  );
  assertEquals(
    seenHashes.length,
    uniqueHashes.size,
    "Same-topology creatures should be adjacent (contiguous blocks)",
  );
});

Deno.test("Fitness — all creatures evaluated when grouping disabled", async () => {
  const worker = new OrderTrackingWorker();
  const config: RequiredParallelEvaluationConfig = {
    topologyGrouping: false,
    maxConcurrentEvaluations: 0,
  };
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    config,
  );

  const creatures = [
    createCreature("TANH", 0.1),
    createCreature("LOGISTIC", 0.2),
    createCreature("RELU", 0.3),
  ];

  await fitness.calculate(creatures);

  assertEquals(
    worker.evaluationOrder.length,
    3,
    "All 3 creatures should be evaluated",
  );

  for (const creature of creatures) {
    assert(
      creature.score !== undefined,
      "Every creature should have a score",
    );
  }
});

Deno.test("Fitness — grouping enabled produces same scores as disabled", async () => {
  // Create identical populations for both runs
  const makePopulation = () => [
    createCreature("TANH", 0.1),
    createCreature("LOGISTIC", 0.2),
    createCreature("RELU", 0.3),
  ];

  const workerGrouped = new OrderTrackingWorker();
  const fitnessGrouped = new Fitness(
    [workerGrouped as unknown as WorkerHandler],
    0.0001,
    false,
    { topologyGrouping: true, maxConcurrentEvaluations: 0 },
  );

  const workerUngrouped = new OrderTrackingWorker();
  const fitnessUngrouped = new Fitness(
    [workerUngrouped as unknown as WorkerHandler],
    0.0001,
    false,
    { topologyGrouping: false, maxConcurrentEvaluations: 0 },
  );

  const popGrouped = makePopulation();
  const popUngrouped = makePopulation();

  await fitnessGrouped.calculate(popGrouped);
  await fitnessUngrouped.calculate(popUngrouped);

  // Both populations should have the same scores (order may differ)
  const groupedScores = popGrouped.map((c) => c.score).sort();
  const ungroupedScores = popUngrouped.map((c) => c.score).sort();

  assertEquals(
    groupedScores,
    ungroupedScores,
    "Scores should be identical regardless of grouping setting",
  );
});
