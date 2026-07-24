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

  // The tuning-statistics group is flattened onto the run result (Issue #3422).
  // Configured population size is always recorded, adaptive off by default.
  assertEquals(result.populationSize, 12);
  assert(
    !Object.hasOwn(result, "finalPopulationSize"),
    "finalPopulationSize omitted when adaptive sizing is off",
  );

  // Hardware descriptor present with the three known keys.
  assert(Object.hasOwn(result.hardware, "cpuCores"));
  assert(Object.hasOwn(result.hardware, "totalMemoryBytes"));
  assert(Object.hasOwn(result.hardware, "host"));

  // Requested options echoed as the caller's changes from defaults, with the
  // non-serialisable callback dropped entirely rather than marked (Issue #3427).
  assertEquals(result.requestedOptions.populationSize, 12);
  assertEquals(result.requestedOptions.iterations, 8);
  assertEquals(
    Object.hasOwn(result.requestedOptions, "onTrainingEvent"),
    false,
  );

  // Improvement summary reflects the run: final score matches result.score and
  // milestone fractions are a subset of the fixed schedule.
  assertEquals(result.scoreImprovement.finalScore, result.score);
  for (const m of result.scoreImprovement.milestones) {
    assert(
      [0.25, 0.5, 0.75, 0.9].includes(m.fraction),
      `unexpected milestone fraction ${m.fraction}`,
    );
    assert(m.generation >= 1, "milestone generation must be >= 1");
    assert(m.timeMs >= 0, "milestone timeMs must be non-negative");
    assert(m.scoredCount >= 0, "milestone scoredCount must be non-negative");
  }

  // The whole result must survive JSON serialisation (it lands in result.json),
  // with the callback dropped rather than echoed as a function body or marker.
  const json = JSON.stringify(result);
  assert(json.length > 0);
  assert(!json.includes("onTrainingEvent"), "callback dropped from echo");
});
