/**
 * Test suite for fitness evaluation deduplication (Issue #1016).
 *
 * When multiple identical creatures (same UUID) are present in a population,
 * they should only be evaluated once and the score should be shared.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Fitness } from "../src/architecture/Fitness.ts";
import type { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Mock worker handler that counts how many times evaluate is called.
 */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  private busy = false;
  private idleListeners: (() => void)[] = [];
  private evaluatedCreatures: Map<string, number> = new Map();

  addIdleListener(callback: () => void): void {
    this.idleListeners.push(callback);
  }

  isBusy(): boolean {
    return this.busy;
  }

  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.busy = true;
    this.evaluateCallCount++;

    const uuid = CreatureUtil.makeUUID(creature);
    const currentCount = this.evaluatedCreatures.get(uuid) || 0;
    this.evaluatedCreatures.set(uuid, currentCount + 1);

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 1));

    this.busy = false;

    // Notify idle listeners
    for (const listener of this.idleListeners) {
      listener();
    }

    // Return a deterministic error based on creature structure
    // This simulates actual fitness evaluation
    const error = 0.1;
    return { evaluate: { error } };
  }

  getEvaluationCountForUUID(uuid: string): number {
    return this.evaluatedCreatures.get(uuid) || 0;
  }

  reset(): void {
    this.evaluateCallCount = 0;
    this.evaluatedCreatures.clear();
  }
}

Deno.test("Fitness.calculate - deduplicates identical creatures by UUID", async () => {
  const mockWorker = new MockWorkerHandler();
  const fitness = new Fitness(
    [mockWorker as unknown as WorkerHandler],
    0.0001, // growth cost
    false, // feedbackLoop
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

  // Create three identical creatures
  const creature1 = Creature.fromJSON(baseCreature);
  const creature2 = Creature.fromJSON(baseCreature);
  const creature3 = Creature.fromJSON(baseCreature);

  // Generate UUIDs for all creatures
  const uuid1 = CreatureUtil.makeUUID(creature1);
  const uuid2 = CreatureUtil.makeUUID(creature2);
  const uuid3 = CreatureUtil.makeUUID(creature3);

  // Verify they all have the same UUID
  assertEquals(uuid1, uuid2, "Identical creatures should have same UUID");
  assertEquals(uuid2, uuid3, "Identical creatures should have same UUID");

  // All creatures should have undefined scores initially
  assertEquals(
    creature1.score,
    undefined,
    "Score should be undefined initially",
  );
  assertEquals(
    creature2.score,
    undefined,
    "Score should be undefined initially",
  );
  assertEquals(
    creature3.score,
    undefined,
    "Score should be undefined initially",
  );

  const population = [creature1, creature2, creature3];

  // Calculate fitness
  await fitness.calculate(population);

  // Only ONE evaluation should have occurred (not three)
  assertEquals(
    mockWorker.evaluateCallCount,
    1,
    "Should only evaluate once for identical creatures",
  );

  // All creatures should now have scores
  assert(creature1.score !== undefined, "Creature 1 should have score");
  assert(creature2.score !== undefined, "Creature 2 should have score");
  assert(creature3.score !== undefined, "Creature 3 should have score");

  // All creatures should have the same score
  assertEquals(
    creature1.score,
    creature2.score,
    "Identical creatures should have same score",
  );
  assertEquals(
    creature2.score,
    creature3.score,
    "Identical creatures should have same score",
  );
});

Deno.test("Fitness.calculate - different creatures are evaluated separately", async () => {
  const mockWorker = new MockWorkerHandler();
  const fitness = new Fitness(
    [mockWorker as unknown as WorkerHandler],
    0.0001, // growth cost
    false, // feedbackLoop
  );

  // Two creatures with different weights (different UUIDs)
  const creature1 = Creature.fromJSON({
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

  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.9 }, // Different bias
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 }, // Different weight
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  // Generate UUIDs
  const uuid1 = CreatureUtil.makeUUID(creature1);
  const uuid2 = CreatureUtil.makeUUID(creature2);

  // Verify they have different UUIDs
  assert(uuid1 !== uuid2, "Different creatures should have different UUIDs");

  const population = [creature1, creature2];

  // Calculate fitness
  await fitness.calculate(population);

  // Both creatures should be evaluated
  assertEquals(
    mockWorker.evaluateCallCount,
    2,
    "Different creatures should each be evaluated",
  );
});

Deno.test("Fitness.calculate - skips creatures that already have scores", async () => {
  const mockWorker = new MockWorkerHandler();
  const fitness = new Fitness(
    [mockWorker as unknown as WorkerHandler],
    0.0001, // growth cost
    false, // feedbackLoop
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

  const creature1 = Creature.fromJSON(baseCreature);
  creature1.score = 0.9; // Already has a score

  const creature2 = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.8 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });
  // creature2 has no score (undefined)

  const population = [creature1, creature2];

  // Calculate fitness
  await fitness.calculate(population);

  // Only creature2 should be evaluated (creature1 already has a score)
  assertEquals(
    mockWorker.evaluateCallCount,
    1,
    "Should only evaluate creatures without scores",
  );

  // creature1's score should be unchanged
  assertEquals(creature1.score, 0.9, "Pre-existing score should be preserved");
});

Deno.test("Fitness.calculate - mixed population with duplicates and uniques", async () => {
  const mockWorker = new MockWorkerHandler();
  const fitness = new Fitness(
    [mockWorker as unknown as WorkerHandler],
    0.0001, // growth cost
    false, // feedbackLoop
  );

  // Create base creatures
  const baseA: CreatureExport = {
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

  const baseB: CreatureExport = {
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
  };

  // Create population: 3 copies of A, 2 copies of B
  const population = [
    Creature.fromJSON(baseA),
    Creature.fromJSON(baseA),
    Creature.fromJSON(baseB),
    Creature.fromJSON(baseA),
    Creature.fromJSON(baseB),
  ];

  // Generate UUIDs
  for (const creature of population) {
    CreatureUtil.makeUUID(creature);
  }

  // Calculate fitness
  await fitness.calculate(population);

  // Should only evaluate 2 unique creatures (A and B), not 5
  assertEquals(
    mockWorker.evaluateCallCount,
    2,
    "Should only evaluate unique creatures",
  );

  // All creatures should have scores
  for (const creature of population) {
    assert(creature.score !== undefined, "All creatures should have scores");
  }

  // All A creatures should have the same score
  assertEquals(population[0].score, population[1].score);
  assertEquals(population[1].score, population[3].score);

  // All B creatures should have the same score
  assertEquals(population[2].score, population[4].score);
});
