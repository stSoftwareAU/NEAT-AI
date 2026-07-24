/**
 * Integration test: the evolve* functions record run-level tuning statistics on
 * their result (Issue #3422) — the configured population size, an echo of the
 * caller-requested options, hardware descriptors, and a milestone summary of
 * the score-improvement curve — so a persisted `result.json` is self-contained
 * enough to compare configurations across machines.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { SCORE_IMPROVEMENT_FRACTIONS } from "@creature/ScoreImprovementMilestones.ts";
import { initWasmForTests } from "../_initWasm.ts";

const XOR = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

Deno.test("evolveDataSet records populationSize and requested options", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(XOR, {
    iterations: 5,
    targetError: 0,
    populationSize: 12,
    threads: 1,
  });

  // Configured population size is always recorded explicitly.
  assertEquals(result.populationSize, 12);
  // Adaptive sizing was not enabled, so no final population size is recorded.
  assertEquals(Object.hasOwn(result, "finalPopulationSize"), false);

  // Only the caller-requested options are echoed (changes from defaults),
  // not the full resolved config.
  assertEquals(result.requestedOptions.populationSize, 12);
  assertEquals(result.requestedOptions.iterations, 5);
  assertEquals(result.requestedOptions.threads, 1);
  // A default the caller never set must not appear in the echo.
  assertEquals(Object.hasOwn(result.requestedOptions, "costName"), false);
});

Deno.test("evolveDataSet records hardware descriptors", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(XOR, {
    iterations: 3,
    populationSize: 10,
    threads: 1,
  });

  const hw = result.hardware;
  assertEquals(Object.keys(hw).sort(), [
    "cpuCores",
    "host",
    "totalMemoryBytes",
  ]);
  // cpuCores needs no permission; the best-effort fields may be null under the
  // test runner's permission set, but the descriptor object is always present.
  if (hw.cpuCores !== null) {
    assert(hw.cpuCores > 0, "cpuCores must be positive when present");
  }
});

Deno.test("evolveDataSet records score-improvement milestones", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(XOR, {
    iterations: 12,
    targetError: 0,
    populationSize: 20,
    threads: 1,
  });

  const summary = result.scoreImprovement;
  // Baseline and final are the run's first and last champion scores.
  assert(summary.finalScore >= summary.initialScore);
  assertEquals(
    summary.totalImprovement,
    summary.finalScore - summary.initialScore,
  );

  // When the run improved, milestones are ordered by fraction and each records
  // a non-decreasing generation/time/scored-count as the curve progresses.
  if (summary.totalImprovement > 0) {
    assert(summary.milestones.length > 0, "expected at least one milestone");
    assert(
      summary.milestones.length <= SCORE_IMPROVEMENT_FRACTIONS.length,
      "no more milestones than fractions",
    );
    let prevGen = 0;
    let prevScore = summary.initialScore;
    for (const milestone of summary.milestones) {
      assert(
        SCORE_IMPROVEMENT_FRACTIONS.includes(milestone.fraction),
        `unexpected fraction ${milestone.fraction}`,
      );
      const target = summary.initialScore +
        milestone.fraction * summary.totalImprovement;
      assert(
        milestone.score >= target - 1e-9,
        "milestone score must reach its fraction target",
      );
      assert(milestone.generation >= prevGen, "generations non-decreasing");
      assert(milestone.score >= prevScore - 1e-9, "scores non-decreasing");
      assert(milestone.generation >= 1, "generation is 1-based");
      assert(milestone.scoredCount > 0, "scored-count must be positive");
      prevGen = milestone.generation;
      prevScore = milestone.score;
    }
  }
});

Deno.test("evolveDataSet records finalPopulationSize when adaptive sizing enabled", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(XOR, {
    iterations: 4,
    populationSize: 15,
    threads: 1,
    adaptivePopulation: { enabled: true },
  });

  assertEquals(result.populationSize, 15);
  // With adaptive sizing on, the final effective population size is recorded.
  assertEquals(typeof result.finalPopulationSize, "number");
  assert(
    (result.finalPopulationSize ?? 0) > 0,
    "finalPopulationSize must be positive",
  );
});
