/**
 * Benchmark: main-thread Score.calculate work per fitness evaluation.
 * Issue #2259: Measure the main-thread cost of calculateScore + tag
 * propagation in Fitness.ts after each worker.evaluate call.
 *
 * This isolates the work that runs on the main thread per creature
 * after the worker returns a fixed error value, at varying synapse counts.
 *
 * Usage:
 *   deno run -A bench/MainThreadScoreWork.ts
 */

import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";

/** Creature size configurations to benchmark. */
const SIZES = [
  {
    label: "Small (50 syn)",
    inputs: 5,
    outputs: 2,
    layers: [{ count: 5, squash: IDENTITY.NAME }],
  },
  {
    label: "Medium (500 syn)",
    inputs: 10,
    outputs: 3,
    layers: [{ count: 20, squash: IDENTITY.NAME }, {
      count: 10,
      squash: LOGISTIC.NAME,
    }],
  },
  {
    label: "Large (5k syn)",
    inputs: 20,
    outputs: 5,
    layers: [{ count: 50, squash: IDENTITY.NAME }, {
      count: 30,
      squash: LOGISTIC.NAME,
    }],
  },
  {
    label: "XL (11k syn)",
    inputs: 50,
    outputs: 5,
    layers: [{ count: 100, squash: IDENTITY.NAME }, {
      count: 50,
      squash: LOGISTIC.NAME,
    }, { count: 25, squash: IDENTITY.NAME }],
  },
  {
    label: "XXL (50k+ syn)",
    inputs: 100,
    outputs: 10,
    layers: [
      { count: 200, squash: IDENTITY.NAME },
      { count: 150, squash: LOGISTIC.NAME },
      { count: 100, squash: IDENTITY.NAME },
      { count: 50, squash: LOGISTIC.NAME },
    ],
  },
] as const;

const ITERATIONS = 2000;
const WARMUP = 200;
const GROWTH_COST = 0.0001;

interface SizeResult {
  label: string;
  neurons: number;
  synapses: number;
  /** Average microseconds for full main-thread work (score + tags + dupe copy). */
  avgFullUs: number;
  /** Average microseconds for calculateScore alone (uncached). */
  avgScoreUncachedUs: number;
  /** Average microseconds for calculateScore alone (cached). */
  avgScoreCachedUs: number;
  /** Average microseconds for tag operations only. */
  avgTagsUs: number;
}

function formatUs(us: number): string {
  if (us < 1) return `${(us * 1000).toFixed(0)}ns`;
  if (us < 1000) return `${us.toFixed(2)}µs`;
  return `${(us / 1000).toFixed(3)}ms`;
}

function runBenchmark(): SizeResult[] {
  console.log("=".repeat(70));
  console.log("Main-thread Score Work per Fitness Evaluation (Issue #2259)");
  console.log("=".repeat(70));
  console.log();

  const results: SizeResult[] = [];

  for (const size of SIZES) {
    const creature = new Creature(size.inputs, size.outputs, {
      layers: [...size.layers],
      outputLayer: { squash: IDENTITY.NAME },
    });

    console.log(`--- ${size.label} ---`);
    console.log(
      `  Neurons: ${creature.neurons.length}  Synapses: ${creature.synapses.length}`,
    );

    // Create a "duplicate" creature for dupe-copy path
    const duplicate = new Creature(size.inputs, size.outputs, {
      layers: [...size.layers],
      outputLayer: { squash: IDENTITY.NAME },
    });

    // ------ Warmup ------
    for (let i = 0; i < WARMUP; i++) {
      creature.invalidateScoreCache();
      const error = Math.random() * 0.5;
      addTag(creature, "error", error.toString());
      const score = calculateScore(creature, error, GROWTH_COST);
      creature.score = score;
      addTag(creature, "score", score.toString());
    }

    // ------ Benchmark 1: Full main-thread work (score + tags + dupe copy) ------
    const fullTimes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Cache is already warm from previous iteration (realistic scenario:
      // creature structure doesn't change between worker.evaluate calls)
      const error = Math.random() * 0.5;

      const start = performance.now();
      addTag(creature, "error", error.toString());
      creature.score = calculateScore(creature, error, GROWTH_COST);
      addTag(creature, "score", creature.score.toString());
      // Simulate duplicate copy (common in Fitness.calculate)
      const errorTag = getTag(creature, "error");
      const scoreTag = getTag(creature, "score");
      duplicate.score = creature.score;
      if (errorTag) addTag(duplicate, "error", errorTag);
      if (scoreTag) addTag(duplicate, "score", scoreTag);
      fullTimes.push(performance.now() - start);
    }

    // ------ Benchmark 2: calculateScore only (uncached) ------
    const uncachedTimes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      creature.invalidateScoreCache();
      const error = Math.random() * 0.5;
      const start = performance.now();
      calculateScore(creature, error, GROWTH_COST);
      uncachedTimes.push(performance.now() - start);
    }

    // ------ Benchmark 3: calculateScore only (cached) ------
    // Populate cache once
    creature.invalidateScoreCache();
    calculateScore(creature, 0.1, GROWTH_COST);
    const cachedTimes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const error = Math.random() * 0.5;
      const start = performance.now();
      calculateScore(creature, error, GROWTH_COST);
      cachedTimes.push(performance.now() - start);
    }

    // ------ Benchmark 4: Tag operations only ------
    const tagTimes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const error = Math.random() * 0.5;
      const start = performance.now();
      addTag(creature, "error", error.toString());
      addTag(creature, "score", error.toString());
      const errorTag = getTag(creature, "error");
      const scoreTag = getTag(creature, "score");
      if (errorTag) addTag(duplicate, "error", errorTag);
      if (scoreTag) addTag(duplicate, "score", scoreTag);
      tagTimes.push(performance.now() - start);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const toUs = (ms: number) => ms * 1000;

    const result: SizeResult = {
      label: size.label,
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      avgFullUs: toUs(avg(fullTimes)),
      avgScoreUncachedUs: toUs(avg(uncachedTimes)),
      avgScoreCachedUs: toUs(avg(cachedTimes)),
      avgTagsUs: toUs(avg(tagTimes)),
    };
    results.push(result);

    console.log(`  Full main-thread work:    ${formatUs(result.avgFullUs)}`);
    console.log(
      `  Score (uncached):         ${formatUs(result.avgScoreUncachedUs)}`,
    );
    console.log(
      `  Score (cached):           ${formatUs(result.avgScoreCachedUs)}`,
    );
    console.log(`  Tags only:               ${formatUs(result.avgTagsUs)}`);
    console.log();
  }

  // ------ Summary ------
  console.log("=".repeat(70));
  console.log(
    "Summary: Main-thread cost per creature at varying network sizes",
  );
  console.log("=".repeat(70));
  console.log();

  // Compare against realistic worker evaluation times
  const workerTimeMs = 10; // Conservative lower bound for worker.evaluate
  console.log(
    `Reference: worker.evaluate typically takes ≥${workerTimeMs}ms per creature`,
  );
  console.log();
  console.log(
    `${"Size".padEnd(22)} ${"Synapses".padStart(8)} ${
      "Full(µs)".padStart(10)
    } ` +
      `${"Score(µs)".padStart(10)} ${"Tags(µs)".padStart(10)} ${
        "% of worker".padStart(12)
      }`,
  );
  console.log("-".repeat(74));

  for (const r of results) {
    const pctOfWorker = (r.avgFullUs / (workerTimeMs * 1000)) * 100;
    console.log(
      `${r.label.padEnd(22)} ${String(r.synapses).padStart(8)} ` +
        `${formatUs(r.avgFullUs).padStart(10)} ` +
        `${formatUs(r.avgScoreCachedUs).padStart(10)} ` +
        `${formatUs(r.avgTagsUs).padStart(10)} ` +
        `${pctOfWorker.toFixed(3).padStart(11)}%`,
    );
  }

  console.log();

  // Population-level estimate
  const popSize = 200;
  console.log(`Population-level estimate (${popSize} creatures):`);
  for (const r of results) {
    const totalMs = (r.avgFullUs * popSize) / 1000;
    console.log(
      `  ${r.label.padEnd(22)} total main-thread: ${totalMs.toFixed(3)}ms`,
    );
  }
  console.log();

  // JSON summary
  console.log("JSON Summary:");
  console.log(JSON.stringify(
    {
      benchmark: "MainThreadScoreWork",
      issue: 2259,
      iterations: ITERATIONS,
      referenceWorkerMs: workerTimeMs,
      results: results.map((r) => ({
        label: r.label,
        neurons: r.neurons,
        synapses: r.synapses,
        avgFullUs: Number(r.avgFullUs.toFixed(3)),
        avgScoreUncachedUs: Number(r.avgScoreUncachedUs.toFixed(3)),
        avgScoreCachedUs: Number(r.avgScoreCachedUs.toFixed(3)),
        avgTagsUs: Number(r.avgTagsUs.toFixed(3)),
        pctOfWorker: Number(
          ((r.avgFullUs / (workerTimeMs * 1000)) * 100).toFixed(4),
        ),
      })),
    },
    null,
    2,
  ));

  return results;
}

runBenchmark();
