/**
 * Fitness must not evaluate on a quarantined worker (GRQ #4489).
 *
 * A worker that swallowed a training task is stopped and taken out of service.
 * Posting an evaluation to it buys a promise that can never settle, which would
 * turn one wedged worker into a stalled generation. The healthy workers take
 * the whole queue instead.
 *
 * The degenerate case — every worker quarantined — keeps the list whole and
 * says so, because an empty worker list leaves creatures unscored and
 * `evolve()` asserts on that.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Mock worker that records how many creatures it was asked to evaluate. */
class MockWorker {
  public evaluationCount = 0;

  constructor(private healthy = true) {}

  isHealthy(): boolean {
    return this.healthy;
  }

  quarantine(): void {
    this.healthy = false;
  }

  evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluationCount++;
    return Promise.resolve({ evaluate: { error: 0.05 } });
  }
}

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

Deno.test("a quarantined worker gets no evaluations (GRQ #4489)", async () => {
  const healthy = new MockWorker();
  const wedged = new MockWorker(false);

  const fitness = new Fitness(
    [healthy, wedged] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.1), makeCreature(0.2), makeCreature(0.3)];
  await fitness.calculate(population);

  assertEquals(
    wedged.evaluationCount,
    0,
    "a stopped worker must never be handed an evaluation",
  );
  assertEquals(
    healthy.evaluationCount,
    3,
    "the healthy worker takes the whole queue",
  );
  for (const creature of population) {
    assert(
      creature.score !== undefined,
      "every creature is still scored",
    );
  }
});

Deno.test("every creature is scored even if every worker is quarantined (GRQ #4489)", async () => {
  const wedgedA = new MockWorker(false);
  const wedgedB = new MockWorker(false);

  const fitness = new Fitness(
    [wedgedA, wedgedB] as unknown[] as WorkerHandler[],
    0.0001,
    false,
  );

  const population = [makeCreature(0.4), makeCreature(0.5)];
  await fitness.calculate(population);

  assertEquals(
    wedgedA.evaluationCount + wedgedB.evaluationCount,
    2,
    "with nothing healthy left the queue is still drained, never dropped",
  );
});
