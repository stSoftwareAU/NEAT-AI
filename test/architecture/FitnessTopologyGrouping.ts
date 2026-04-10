/**
 * Test suite for Fitness topology grouping correctness (Issue #2123).
 *
 * Verifies that when topology grouping is enabled, creatures are sorted
 * by topology hash so that same-topology creatures are adjacent in the
 * evaluation queue.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { RequiredParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker that records the order creatures are evaluated in.
 */
class OrderTrackingWorker {
  public evaluationOrder: Creature[] = [];

  addIdleListener(_callback: () => void): void {
    // no-op
  }

  isBusy(): boolean {
    return false;
  }

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluationOrder.push(creature);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { evaluate: { error: 0.1 } };
  }
}

/** Create a simple creature with one hidden neuron and given squash. */
function makeCreature(squash: string, bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash, bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(data);
}

/** Create a creature with two hidden neurons (different topology). */
function makeLargerCreature(bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(data);
}

Deno.test("Fitness topology grouping - creatures grouped by topology hash", async () => {
  const worker = new OrderTrackingWorker();

  const evalConfig: RequiredParallelEvaluationConfig = {
    topologyGrouping: true,
    maxConcurrentEvaluations: 0,
  };

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfig,
  );

  // Create creatures with two different topologies, interleaved.
  // Topology A: one hidden TANH neuron (different weights = different UUIDs)
  // Topology B: two hidden neurons (TANH + LOGISTIC)
  const creatureA1 = makeCreature("TANH", 0.1);
  const creatureB1 = makeLargerCreature(0.2);
  const creatureA2 = makeCreature("TANH", 0.3);
  const creatureB2 = makeLargerCreature(0.4);
  const creatureA3 = makeCreature("TANH", 0.5);

  const population = [
    creatureA1,
    creatureB1,
    creatureA2,
    creatureB2,
    creatureA3,
  ];

  // Compute topology hashes
  const hashA = CreatureUtil.getTopologyHash(creatureA1);
  const hashB = CreatureUtil.getTopologyHash(creatureB1);

  // Verify these are different topologies
  assert(hashA !== hashB, "Different topologies should have different hashes");

  // Verify same topologies have same hash
  assertEquals(
    hashA,
    CreatureUtil.getTopologyHash(creatureA2),
    "Same topology should have same hash",
  );
  assertEquals(
    hashB,
    CreatureUtil.getTopologyHash(creatureB2),
    "Same topology should have same hash",
  );

  await fitness.calculate(population);

  // All creatures should have been evaluated (different UUIDs due to different weights)
  assertEquals(worker.evaluationOrder.length, 5);

  // Verify grouping: creatures with same topology hash should be adjacent
  const evaluatedHashes = worker.evaluationOrder.map((c) =>
    CreatureUtil.getTopologyHash(c)
  );

  // Check that all creatures of the same topology are contiguous
  const seen = new Set<string>();
  let lastHash = "";
  for (const hash of evaluatedHashes) {
    if (hash !== lastHash) {
      assert(
        !seen.has(hash),
        `Topology hash ${hash} appeared non-contiguously in evaluation order — ` +
          `grouping is broken. Order: [${evaluatedHashes.join(", ")}]`,
      );
      seen.add(hash);
      lastHash = hash;
    }
  }
});

Deno.test("Fitness topology grouping disabled - all creatures still evaluated", async () => {
  const worker = new OrderTrackingWorker();

  const evalConfig: RequiredParallelEvaluationConfig = {
    topologyGrouping: false,
    maxConcurrentEvaluations: 0,
  };

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfig,
  );

  const creatureA = makeCreature("TANH", 0.1);
  const creatureB = makeLargerCreature(0.2);
  const creatureC = makeCreature("TANH", 0.5);

  const population = [creatureA, creatureB, creatureC];

  await fitness.calculate(population);

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  assertEquals(
    worker.evaluationOrder.length,
    3,
    "All unique creatures should be evaluated",
  );
});

Deno.test("Fitness topology grouping - preserves correctness of scores", async () => {
  const worker = new OrderTrackingWorker();

  const evalConfig: RequiredParallelEvaluationConfig = {
    topologyGrouping: true,
    maxConcurrentEvaluations: 0,
  };

  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    evalConfig,
  );

  // Mix of topologies
  const creatureA = makeCreature("TANH", 0.1);
  const creatureB = makeLargerCreature(0.2);

  const population = [creatureA, creatureB];

  await fitness.calculate(population);

  // Both should have valid scores
  assert(
    creatureA.score !== undefined && typeof creatureA.score === "number",
    "Creature A should have a numeric score",
  );
  assert(
    creatureB.score !== undefined && typeof creatureB.score === "number",
    "Creature B should have a numeric score",
  );
});
