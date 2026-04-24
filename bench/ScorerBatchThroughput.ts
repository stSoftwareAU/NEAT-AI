/**
 * Benchmark: scorer throughput in batch vs per-creature modes (Issue #2424).
 *
 * Runs `Fitness.calculate()` across population sizes of 20, 50, and 100
 * creatures and reports:
 *   - Wall-clock time for the fitness phase
 *   - Main-thread scorer wall time (`Fitness.lastScorerMs`)
 *   - Unique-scored creature count (`Fitness.lastScoredCreatureCount`)
 *   - Derived creatures/sec throughput
 *
 * Two modes are compared:
 *   - "batch" (one-pass, topologyGrouping=true): the current production
 *     configuration where same-topology creatures cluster on the same
 *     worker and reuse the WASM compilation cache.
 *   - "per-creature" (topologyGrouping=false): the legacy baseline where
 *     creatures are evaluated in population order, defeating cache reuse.
 *
 * Uses an in-process stub worker so the benchmark measures the scheduling
 * and scorer paths directly, without worker thread overhead that would
 * dominate on small populations. Worker latency is simulated with a small
 * sleep that is the same in both modes, so any speedup comes from the
 * scorer/scheduler path, not from network evaluation.
 *
 * Usage:
 *   deno run -A bench/ScorerBatchThroughput.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { RequiredParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

/** Population sizes covered by the benchmark matrix. */
const POPULATION_SIZES = [20, 50, 100] as const;
/** Number of distinct topologies generated per population. */
const TOPOLOGY_VARIANTS = 5;
/** Simulated worker evaluation latency in ms (same across both modes). */
const WORKER_LATENCY_MS = 1;
/** Number of repeats per configuration to reduce jitter. */
const REPEATS = 3;
/** Warm-up runs before measurement. */
const WARMUP_RUNS = 1;

/** Stub worker that returns a fixed error after a small async delay. */
class StubWorker {
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    if (WORKER_LATENCY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_LATENCY_MS));
    }
    return { evaluate: { error: 0.1 } };
  }
}

/** Build a small creature with a given topology variant and bias. */
function makeCreature(variant: number, bias: number): Creature {
  const hiddenCount = 2 + (variant % TOPOLOGY_VARIANTS);
  const hiddenNeurons = Array.from({ length: hiddenCount }, (_, i) => ({
    type: "hidden" as const,
    uuid: `v${variant}-h${i}-b${bias}`,
    squash: i % 2 === 0 ? "TANH" : "LOGISTIC",
    bias: bias + i * 0.01,
  }));

  const neurons = [
    ...hiddenNeurons,
    {
      type: "output" as const,
      uuid: `v${variant}-out-b${bias}`,
      squash: "IDENTITY",
      bias: 0,
    },
  ];

  const synapses = [
    { fromUUID: "input-0", toUUID: hiddenNeurons[0].uuid, weight: 0.5 },
    {
      fromUUID: hiddenNeurons[hiddenNeurons.length - 1].uuid,
      toUUID: neurons[neurons.length - 1].uuid,
      weight: 0.8,
    },
    ...hiddenNeurons.slice(1).map((n, i) => ({
      fromUUID: hiddenNeurons[i].uuid,
      toUUID: n.uuid,
      weight: 0.3 + i * 0.01,
    })),
  ];

  const data: CreatureExport = { neurons, synapses, input: 2, output: 1 };
  return Creature.fromJSON(data);
}

/** Build a population mixing several topology variants for realism. */
function buildPopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const variant = i % TOPOLOGY_VARIANTS;
    population.push(makeCreature(variant, i * 0.001));
  }
  return population;
}

interface BenchResult {
  mode: "batch" | "per-creature";
  populationSize: number;
  fitnessMs: number;
  scorerMs: number;
  scoredCount: number;
  creaturesPerSec: number;
}

async function runOnce(
  mode: "batch" | "per-creature",
  size: number,
): Promise<BenchResult> {
  const config: RequiredParallelEvaluationConfig = {
    topologyGrouping: mode === "batch",
    maxConcurrentEvaluations: 0,
  };

  // Use a small worker pool so scheduling matters; values mirror a typical
  // laptop core count.
  const workers = Array.from(
    { length: 4 },
    () => new StubWorker() as unknown as WorkerHandler,
  );
  const fitness = new Fitness(workers, 0.0001, false, config);
  const population = buildPopulation(size);

  const start = performance.now();
  await fitness.calculate(population);
  const fitnessMs = performance.now() - start;

  const creaturesPerSec = fitnessMs > 0
    ? (fitness.lastScoredCreatureCount * 1000) / fitnessMs
    : 0;

  return {
    mode,
    populationSize: size,
    fitnessMs,
    scorerMs: fitness.lastScorerMs,
    scoredCount: fitness.lastScoredCreatureCount,
    creaturesPerSec,
  };
}

async function runConfiguration(
  mode: "batch" | "per-creature",
  size: number,
): Promise<BenchResult> {
  // Warm up to stabilise JIT and caches. Must run serially so the JIT is hot
  // before measurement; parallel execution would invalidate the timings.
  for (let i = 0; i < WARMUP_RUNS; i++) {
    // deno-lint-ignore no-await-in-loop
    await runOnce(mode, size);
  }

  const samples: BenchResult[] = [];
  for (let i = 0; i < REPEATS; i++) {
    // Serial by design — concurrent runs would contend for the event loop
    // and skew wall-clock timing, which is the whole point of the benchmark.
    // deno-lint-ignore no-await-in-loop
    samples.push(await runOnce(mode, size));
  }

  // Median aggregation — robust to the occasional GC pause.
  samples.sort((a, b) => a.fitnessMs - b.fitnessMs);
  return samples[Math.floor(samples.length / 2)];
}

async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log(
    "Scorer batch vs per-creature throughput (Issue #2424)",
  );
  console.log("=".repeat(78));
  console.log(
    `Worker latency: ${WORKER_LATENCY_MS}ms  Repeats: ${REPEATS}  ` +
      `Topology variants: ${TOPOLOGY_VARIANTS}`,
  );
  console.log();

  const rows: BenchResult[] = [];
  for (const size of POPULATION_SIZES) {
    for (const mode of ["per-creature", "batch"] as const) {
      // Serial by design — see runConfiguration() for rationale.
      // deno-lint-ignore no-await-in-loop
      rows.push(await runConfiguration(mode, size));
    }
  }

  const header = [
    "Mode".padEnd(12),
    "Pop".padStart(4),
    "Fitness(ms)".padStart(11),
    "Scorer(ms)".padStart(10),
    "Scored".padStart(7),
    "Creatures/sec".padStart(13),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of rows) {
    console.log([
      r.mode.padEnd(12),
      String(r.populationSize).padStart(4),
      r.fitnessMs.toFixed(2).padStart(11),
      r.scorerMs.toFixed(3).padStart(10),
      String(r.scoredCount).padStart(7),
      r.creaturesPerSec.toFixed(1).padStart(13),
    ].join("  "));
  }

  console.log();
  console.log("Speedup (batch / per-creature):");
  for (const size of POPULATION_SIZES) {
    const perCreature = rows.find((r) =>
      r.mode === "per-creature" && r.populationSize === size
    )!;
    const batch = rows.find((r) =>
      r.mode === "batch" && r.populationSize === size
    )!;
    const fitnessSpeedup = perCreature.fitnessMs > 0
      ? perCreature.fitnessMs / batch.fitnessMs
      : 0;
    const throughputSpeedup = perCreature.creaturesPerSec > 0
      ? batch.creaturesPerSec / perCreature.creaturesPerSec
      : 0;
    console.log(
      `  pop=${String(size).padStart(3)}  ` +
        `fitnessMs: ${perCreature.fitnessMs.toFixed(2)} → ` +
        `${batch.fitnessMs.toFixed(2)}  (${fitnessSpeedup.toFixed(2)}×)  ` +
        `creatures/sec: ${perCreature.creaturesPerSec.toFixed(1)} → ` +
        `${batch.creaturesPerSec.toFixed(1)}  ` +
        `(${throughputSpeedup.toFixed(2)}×)`,
    );
  }

  console.log();
  console.log("JSON:");
  console.log(JSON.stringify(
    {
      benchmark: "ScorerBatchThroughput",
      issue: 2424,
      workerLatencyMs: WORKER_LATENCY_MS,
      repeats: REPEATS,
      rows,
    },
    null,
    2,
  ));
}

if (import.meta.main) {
  await main();
}
