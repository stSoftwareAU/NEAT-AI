/**
 * Benchmark: Dynamic worker pool (Issue #2313).
 *
 * Measures the throughput improvement when idle heavy workers assist
 * with fitness evaluation alongside the fast pool. Compares:
 *   1. Fast pool only (baseline — heavy workers idle)
 *   2. Fast pool + idle heavy workers (dynamic pooling)
 */
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

/**
 * Mock worker simulating evaluation work with a small delay.
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
    // Simulate real evaluation work
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { evaluate: { error: 0.05 } };
  }
}

function makeCreature(i: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `hidden-${i}`, squash: "TANH", bias: i * 0.01 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 0.5 },
      { fromUUID: `hidden-${i}`, toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(data);
}

const FAST_WORKER_COUNT = 8;
const HEAVY_WORKER_COUNT = 2;
const POPULATION_SIZE = 200;

Deno.bench(
  `Fitness evaluation — ${FAST_WORKER_COUNT} fast workers only (baseline)`,
  { group: "dynamic-pool", baseline: true },
  async () => {
    const fastWorkers = Array.from(
      { length: FAST_WORKER_COUNT },
      (_, i) => new MockWorker(`fast-${i}`),
    );
    const fitness = new Fitness(
      fastWorkers as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );
    const population = Array.from(
      { length: POPULATION_SIZE },
      (_, i) => makeCreature(i),
    );
    await fitness.calculate(population);
  },
);

Deno.bench(
  `Fitness evaluation — ${FAST_WORKER_COUNT} fast + ${HEAVY_WORKER_COUNT} idle heavy workers`,
  { group: "dynamic-pool" },
  async () => {
    const fastWorkers = Array.from(
      { length: FAST_WORKER_COUNT },
      (_, i) => new MockWorker(`fast-${i}`),
    );
    const heavyWorkers = Array.from(
      { length: HEAVY_WORKER_COUNT },
      (_, i) => new MockWorker(`heavy-${i}`),
    );
    const fitness = new Fitness(
      fastWorkers as unknown[] as WorkerHandler[],
      0.0001,
      false,
    );
    const population = Array.from(
      { length: POPULATION_SIZE },
      (_, i) => makeCreature(i),
    );
    await fitness.calculate(
      population,
      heavyWorkers as unknown[] as WorkerHandler[],
    );
  },
);
