/**
 * Integration test: the evolve* functions return a run-level `statistics` block
 * for throughput tuning (Issue #3422).
 *
 * A real `evolveDataSet` run on XOR must self-report the configured population
 * size, the host hardware, an echo of the caller-requested options, and a
 * score-improvement milestone summary — enough for GRQ-cluster's `result.json`
 * to be compared across machines without an external inventory.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import { initWasmForTests } from "../_initWasm.ts";

const XOR = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

Deno.test("evolveDataSet returns run-level tuning statistics", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1);
  const onTrainingEvent = (_event: TrainingEvent) => {};
  const result = await creature.evolveDataSet(XOR, {
    iterations: 8,
    targetError: 0,
    populationSize: 12,
    threads: 1,
    onTrainingEvent,
  });

  const stats = result.statistics;
  assert(stats !== undefined, "statistics block must be present");

  // Configured population size is always recorded, adaptive off by default.
  assertEquals(stats.populationSize, 12);
  assertEquals(stats.adaptivePopulation, false);
  assert(
    !Object.hasOwn(stats, "finalPopulationSize"),
    "finalPopulationSize omitted when adaptive sizing is off",
  );

  // Hardware descriptor present with the three known keys.
  assert(Object.hasOwn(stats.hardware, "cpuCores"));
  assert(Object.hasOwn(stats.hardware, "totalMemoryBytes"));
  assert(Object.hasOwn(stats.hardware, "host"));

  // Requested options echoed as the caller's changes from defaults, with the
  // callback recorded by marker (not serialised).
  assertEquals(stats.requestedOptions.populationSize, 12);
  assertEquals(stats.requestedOptions.iterations, 8);
  assertEquals(stats.requestedOptions.onTrainingEvent, "[function]");

  // Improvement summary reflects the run: final score matches result.score and
  // milestone fractions are a subset of the fixed schedule.
  assertEquals(stats.improvement.finalScore, result.score);
  for (const m of stats.improvement.milestones) {
    assert(
      [0.25, 0.5, 0.75, 0.9].includes(m.fraction),
      `unexpected milestone fraction ${m.fraction}`,
    );
    assert(m.generation >= 1, "milestone generation must be >= 1");
    assert(m.timeMs >= 0, "milestone timeMs must be non-negative");
    assert(m.scoredCount >= 0, "milestone scoredCount must be non-negative");
  }

  // The whole block must survive JSON serialisation (it lands in result.json).
  const json = JSON.stringify(result.statistics);
  assert(json.length > 0);
  assert(!json.includes('"onTrainingEvent":{'), "no function body in echo");
});
