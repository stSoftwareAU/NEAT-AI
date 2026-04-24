/**
 * Fitness scorer runtime telemetry tests (Issue #2424).
 *
 * Verifies that `Fitness.calculate()` captures the scorer wall time and
 * unique-scored creature count on every call so operators can track
 * batch-mode throughput (creatures/sec) across different hardware.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { RequiredParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Worker stub that returns a fixed error so the scorer path runs. */
class FixedErrorWorker {
  constructor(private readonly error: number = 0.1) {}

  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { evaluate: { error: this.error } };
  }
}

/** Worker stub that returns a non-finite error to exercise the skip path. */
class PanicWorker {
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { evaluate: { error: Number.POSITIVE_INFINITY } };
  }
}

function makeCreature(bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `hidden-${bias}`, squash: "TANH", bias },
      { type: "output", uuid: `output-${bias}`, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `hidden-${bias}`, weight: 0.5 },
      { fromUUID: `hidden-${bias}`, toUUID: `output-${bias}`, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(data);
}

const EVAL_CONFIG: RequiredParallelEvaluationConfig = {
  topologyGrouping: false,
  maxConcurrentEvaluations: 0,
};

Deno.test("Fitness scorer telemetry - counts unique scored creatures", async () => {
  const worker = new FixedErrorWorker();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    EVAL_CONFIG,
  );

  const population = [makeCreature(0.1), makeCreature(0.2), makeCreature(0.3)];
  await fitness.calculate(population);

  assertEquals(fitness.lastScoredCreatureCount, 3);
  assert(
    fitness.lastScorerMs >= 0,
    "scorer wall time must be non-negative",
  );
  assert(
    Number.isFinite(fitness.lastScorerMs),
    "scorer wall time must be finite",
  );
});

Deno.test("Fitness scorer telemetry - excludes cached duplicates", async () => {
  const worker = new FixedErrorWorker();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    EVAL_CONFIG,
  );

  // Two distinct UUIDs plus a structural duplicate of the first.
  const originalA = makeCreature(0.1);
  const originalB = makeCreature(0.2);
  const duplicateOfA = makeCreature(0.1); // Same topology + weights + bias.
  const population = [originalA, originalB, duplicateOfA];

  await fitness.calculate(population);

  // Only two unique UUIDs exercise the scorer path; the third is copied.
  assertEquals(fitness.lastScoredCreatureCount, 2);
  assertEquals(
    originalA.score,
    duplicateOfA.score,
    "duplicate should inherit score by UUID copy",
  );
});

Deno.test("Fitness scorer telemetry - empty population resets counters", async () => {
  const worker = new FixedErrorWorker();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    EVAL_CONFIG,
  );

  // Prime the counters with a real run.
  await fitness.calculate([makeCreature(0.1)]);
  assert(fitness.lastScoredCreatureCount > 0);

  // Pre-scored population should reset counters on the next call.
  const alreadyScored = makeCreature(0.2);
  alreadyScored.score = 0.5;
  await fitness.calculate([alreadyScored]);

  assertEquals(fitness.lastScoredCreatureCount, 0);
  assertEquals(fitness.lastScorerMs, 0);
  assertEquals(fitness.lastQueueMaxDepth, 0);
});

Deno.test("Fitness scorer telemetry - skips creatures with non-finite error", async () => {
  const worker = new PanicWorker();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    EVAL_CONFIG,
  );

  const population = [makeCreature(0.1), makeCreature(0.2)];
  await fitness.calculate(population);

  // Non-finite errors bypass calculateScore(), so scorer count is zero.
  assertEquals(fitness.lastScoredCreatureCount, 0);
  for (const creature of population) {
    assertEquals(
      creature.score,
      -Infinity,
      "creatures with panic errors receive the worst score",
    );
  }
});
