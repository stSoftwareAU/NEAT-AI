/**
 * Benchmark for parallel batch creature evaluation (Issue #1862).
 *
 * Compares evaluation performance with and without topology grouping.
 * Topology grouping sorts the evaluation queue by topology hash so
 * same-topology creatures cluster together, improving WASM compilation
 * cache hits.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/ParallelEvaluation.ts
 */
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { RequiredParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

/**
 * Mock worker handler for benchmarking the overhead of topology
 * grouping and queue management (not worker communication).
 */
class BenchMockWorkerHandler {
  isBusy(): boolean {
    return false;
  }

  addIdleListener(_callback: unknown): void {
    // Not used
  }

  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    await Promise.resolve();
    return { evaluate: { error: 0.1 } };
  }
}

/**
 * Create a mixed-topology population with multiple topology groups.
 */
function createMixedPopulation(
  populationSize: number,
  topologyCount: number,
): Creature[] {
  const squashes = ["TANH", "LOGISTIC", "RELU", "IDENTITY", "BIPOLAR_SIGMOID"];
  const creatures: Creature[] = [];

  for (let i = 0; i < populationSize; i++) {
    const topologyIndex = i % topologyCount;
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: squashes[topologyIndex % squashes.length],
          bias: 0.1 + i * 0.001,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-0",
          weight: 0.5 + i * 0.001,
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

const worker = new BenchMockWorkerHandler() as unknown as WorkerHandler;
const workers = [worker];

Deno.bench({
  name: "Sequential (no topology grouping)",
  group: "100 creatures, 5 topologies",
  baseline: true,
  async fn() {
    const evalConfig: RequiredParallelEvaluationConfig = {
      maxConcurrentEvaluations: 0,
      topologyGrouping: false,
    };
    const fitness = new Fitness(workers, 0.0001, false, evalConfig);
    const population = createMixedPopulation(100, 5);
    await fitness.calculate(population);
  },
});

Deno.bench({
  name: "With topology grouping",
  group: "100 creatures, 5 topologies",
  async fn() {
    const evalConfig: RequiredParallelEvaluationConfig = {
      maxConcurrentEvaluations: 0,
      topologyGrouping: true,
    };
    const fitness = new Fitness(workers, 0.0001, false, evalConfig);
    const population = createMixedPopulation(100, 5);
    await fitness.calculate(population);
  },
});

Deno.bench({
  name: "Sequential (no topology grouping) - large",
  group: "500 creatures, 10 topologies",
  baseline: true,
  async fn() {
    const evalConfig: RequiredParallelEvaluationConfig = {
      maxConcurrentEvaluations: 0,
      topologyGrouping: false,
    };
    const fitness = new Fitness(workers, 0.0001, false, evalConfig);
    const population = createMixedPopulation(500, 10);
    await fitness.calculate(population);
  },
});

Deno.bench({
  name: "With topology grouping - large",
  group: "500 creatures, 10 topologies",
  async fn() {
    const evalConfig: RequiredParallelEvaluationConfig = {
      maxConcurrentEvaluations: 0,
      topologyGrouping: true,
    };
    const fitness = new Fitness(workers, 0.0001, false, evalConfig);
    const population = createMixedPopulation(500, 10);
    await fitness.calculate(population);
  },
});
