/**
 * Benchmark for parallel fitness evaluation (Issue #1289).
 *
 * Compares the old reactive idle-listener approach to the new work-stealing
 * pattern for distributing creature evaluations across workers.
 *
 * Since real workers require dataset files and WASM, this benchmark uses mock
 * workers with simulated evaluation latency to measure the scheduling overhead
 * and parallelism characteristics.
 *
 * Run with:
 *   deno bench bench/ParallelFitnessEvaluation.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Fitness } from "../src/architecture/Fitness.ts";
import type { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

/**
 * Mock worker that simulates evaluation with configurable latency.
 */
class BenchMockWorker {
  private busyCount = 0;
  private idleListeners: ((worker: BenchMockWorker) => void)[] = [];

  addIdleListener(callback: (worker: BenchMockWorker) => void): void {
    this.idleListeners.push(callback);
  }

  isBusy(): boolean {
    return this.busyCount > 0;
  }

  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.busyCount++;
    // Simulate evaluation latency
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.busyCount--;

    if (this.busyCount === 0) {
      for (const listener of this.idleListeners) {
        listener(this);
      }
    }

    return { evaluate: { error: 0.1 } };
  }
}

/**
 * Creates a population of unique creatures.
 */
function createPopulation(size: number): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const data: CreatureExport = {
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: "TANH",
          bias: 0.1 + i * 0.001,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-0",
          weight: 0.5 + i * 0.01,
        },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(data);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}

/**
 * Helper to create a Fitness instance with the given number of mock workers.
 */
function createFitness(workerCount: number): Fitness {
  const workers: BenchMockWorker[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(new BenchMockWorker());
  }
  return new Fitness(workers as unknown as WorkerHandler[], 0.0001, false);
}

// Small population (10 creatures)
Deno.bench({
  name: "10 creatures, 1 worker",
  group: "10 creatures",
  baseline: true,
  async fn() {
    const fitness = createFitness(1);
    await fitness.calculate(createPopulation(10));
  },
});

Deno.bench({
  name: "10 creatures, 2 workers",
  group: "10 creatures",
  async fn() {
    const fitness = createFitness(2);
    await fitness.calculate(createPopulation(10));
  },
});

Deno.bench({
  name: "10 creatures, 4 workers",
  group: "10 creatures",
  async fn() {
    const fitness = createFitness(4);
    await fitness.calculate(createPopulation(10));
  },
});

// Medium population (50 creatures)
Deno.bench({
  name: "50 creatures, 1 worker",
  group: "50 creatures",
  baseline: true,
  async fn() {
    const fitness = createFitness(1);
    await fitness.calculate(createPopulation(50));
  },
});

Deno.bench({
  name: "50 creatures, 2 workers",
  group: "50 creatures",
  async fn() {
    const fitness = createFitness(2);
    await fitness.calculate(createPopulation(50));
  },
});

Deno.bench({
  name: "50 creatures, 4 workers",
  group: "50 creatures",
  async fn() {
    const fitness = createFitness(4);
    await fitness.calculate(createPopulation(50));
  },
});

// Large population (100 creatures)
Deno.bench({
  name: "100 creatures, 1 worker",
  group: "100 creatures",
  baseline: true,
  async fn() {
    const fitness = createFitness(1);
    await fitness.calculate(createPopulation(100));
  },
});

Deno.bench({
  name: "100 creatures, 2 workers",
  group: "100 creatures",
  async fn() {
    const fitness = createFitness(2);
    await fitness.calculate(createPopulation(100));
  },
});

Deno.bench({
  name: "100 creatures, 4 workers",
  group: "100 creatures",
  async fn() {
    const fitness = createFitness(4);
    await fitness.calculate(createPopulation(100));
  },
});
