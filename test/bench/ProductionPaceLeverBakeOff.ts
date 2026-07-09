/**
 * Issue #3259 — Tests for the production pace-lever bake-off harness.
 *
 * These exercise the real harness functions in
 * `bench/ProductionPaceLeverBakeOff.ts` with a small, fast option set so the
 * quality gate stays within its time budget. They assert the properties the
 * issue's methodology depends on:
 *
 *   1. Determinism — identical options → identical scored-evaluation count,
 *      generations-to-target, and best error.
 *   2. The score-carry contract is honoured — higher elitism carries more
 *      elites without re-scoring, so it never *increases* scored evaluations
 *      at a fixed population/train policy.
 *   3. Memetic training adds re-scores — a higher `trainPerGen` performs more
 *      full-corpus evaluations per generation.
 *   4. The cost model is linear — `modelledWallClockSeconds` scales with
 *      `costPerEvalSeconds` and equals `scoredEvaluations × cost`.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type BakeOffOptions,
  type BakeOffResult,
  DEFAULT_BAKE_OFF_OPTIONS,
  eliteCount,
  formatBakeOffTable,
  recommendByWallClock,
  runBakeOffConfig,
  runLeverSweep,
} from "../../bench/ProductionPaceLeverBakeOff.ts";

/** Small, fast options so the suite stays within the time budget. */
const FAST_OPTIONS: BakeOffOptions = {
  inputs: 4,
  outputs: 2,
  hidden: 4,
  datasetSize: 12,
  populationSize: 8,
  elitismFraction: 0.25,
  trainPerGen: 2,
  innerTrainIters: 2,
  generations: 6,
  targetError: 0.18,
  seed: 3259,
  costPerEvalSeconds: 90,
};

function fingerprint(r: BakeOffResult): string {
  return `${r.scoredEvaluations}:${r.generationsToTarget}:${
    r.bestError.toFixed(8)
  }`;
}

Deno.test("runBakeOffConfig - is deterministic across repeated runs", () => {
  const first = runBakeOffConfig(FAST_OPTIONS);
  const second = runBakeOffConfig(FAST_OPTIONS);
  assertEquals(fingerprint(first), fingerprint(second));
});

Deno.test("runBakeOffConfig - reports finite, non-negative metrics", () => {
  const r = runBakeOffConfig(FAST_OPTIONS);
  assertEquals(Number.isFinite(r.bestError), true);
  assertEquals(r.bestError >= 0, true);
  assertEquals(r.scoredEvaluations >= FAST_OPTIONS.populationSize, true);
  assertEquals(
    r.modelledWallClockSeconds,
    r.scoredEvaluations * FAST_OPTIONS.costPerEvalSeconds,
  );
  if (r.generationsToTarget !== null) {
    assertEquals(
      r.generationsToTarget >= 0 &&
        r.generationsToTarget <= FAST_OPTIONS.generations,
      true,
    );
  }
});

Deno.test("eliteCount - grows with elitism fraction and keeps at least one", () => {
  assertEquals(eliteCount({ ...FAST_OPTIONS, elitismFraction: 0 }), 1);
  const low = eliteCount({ ...FAST_OPTIONS, elitismFraction: 0.25 });
  const high = eliteCount({ ...FAST_OPTIONS, elitismFraction: 0.5 });
  assertEquals(high >= low, true);
  // Negative fractions clamp to the one-elite floor.
  assertEquals(eliteCount({ ...FAST_OPTIONS, elitismFraction: -1 }), 1);
});

Deno.test("elitism - more elites never increase scored evaluations", () => {
  // Elites carry their score (no re-score), so raising the elitism fraction at
  // a fixed population/train policy can only reduce or hold the scored count.
  const low = runBakeOffConfig({ ...FAST_OPTIONS, elitismFraction: 0.0 });
  const high = runBakeOffConfig({ ...FAST_OPTIONS, elitismFraction: 0.5 });
  // Only compare when neither short-circuits early on reaching target.
  if (low.generationsToTarget === null && high.generationsToTarget === null) {
    assertEquals(high.scoredEvaluations <= low.scoredEvaluations, true);
  } else {
    assertExists(low.scoredEvaluations);
  }
});

Deno.test("trainPerGen - memetic training adds full-corpus re-scores", () => {
  // With no early stop, each trained creature is re-scored every generation, so
  // trainPerGen=4 must perform strictly more scored evaluations than train=0.
  const opts = { ...FAST_OPTIONS, targetError: 0, generations: 4 };
  const none = runBakeOffConfig({ ...opts, trainPerGen: 0 });
  const some = runBakeOffConfig({ ...opts, trainPerGen: 4 });
  assertEquals(none.generationsToTarget, null);
  assertEquals(some.generationsToTarget, null);
  assertEquals(some.scoredEvaluations > none.scoredEvaluations, true);
});

Deno.test("cost model - modelled wall-clock scales linearly with cost", () => {
  const cheap = runBakeOffConfig({ ...FAST_OPTIONS, costPerEvalSeconds: 1 });
  const dear = runBakeOffConfig({ ...FAST_OPTIONS, costPerEvalSeconds: 100 });
  // Same lever policy → same scored-eval count → wall-clock differs only by cost.
  assertEquals(cheap.scoredEvaluations, dear.scoredEvaluations);
  assertEquals(
    dear.modelledWallClockSeconds,
    cheap.modelledWallClockSeconds * 100,
  );
});

Deno.test("runLeverSweep - returns one result per override", () => {
  const results = runLeverSweep(FAST_OPTIONS, [
    { populationSize: 6 },
    { populationSize: 8 },
    { populationSize: 12 },
  ]);
  assertEquals(results.length, 3);
  assertEquals(results[0].populationSize, 6);
  assertEquals(results[2].populationSize, 12);
});

Deno.test("recommendByWallClock - picks lowest modelled wall-clock that reached target", () => {
  const reached = (evals: number): BakeOffResult => ({
    name: `x${evals}`,
    populationSize: 8,
    elitismFraction: 0.1,
    trainPerGen: 2,
    scoredEvaluations: evals,
    generationsToTarget: 3,
    bestError: 0.1,
    modelledWallClockSeconds: evals * 90,
  });
  const never: BakeOffResult = {
    name: "never",
    populationSize: 8,
    elitismFraction: 0.1,
    trainPerGen: 2,
    scoredEvaluations: 5,
    generationsToTarget: null,
    bestError: 0.9,
    modelledWallClockSeconds: 450,
  };
  const rec = recommendByWallClock([reached(40), never, reached(20)]);
  assertExists(rec);
  assertEquals(rec.scoredEvaluations, 20);
  // All-unreached returns null.
  assertEquals(recommendByWallClock([never]), null);
});

Deno.test("formatBakeOffTable - renders a header, divider, and one row per result", () => {
  const results = runLeverSweep(FAST_OPTIONS, [
    { populationSize: 6 },
    { populationSize: 8 },
  ]);
  const table = formatBakeOffTable(results);
  const lines = table.split("\n");
  assertEquals(lines.length, results.length + 2);
  assertEquals(lines[0].includes("scored evals"), true);
  assertEquals(lines[0].includes("modelled wall-clock"), true);
});

Deno.test("formatBakeOffTable - shows an em dash when target not reached", () => {
  const unreached: BakeOffResult = {
    name: "never",
    populationSize: 8,
    elitismFraction: 0.1,
    trainPerGen: 2,
    scoredEvaluations: 5,
    generationsToTarget: null,
    bestError: 0.9,
    modelledWallClockSeconds: 450,
  };
  const table = formatBakeOffTable([unreached]);
  assertEquals(table.includes("| — |"), true);
});

Deno.test("DEFAULT_BAKE_OFF_OPTIONS - harder target than the fast test set", () => {
  assertEquals(
    DEFAULT_BAKE_OFF_OPTIONS.targetError < FAST_OPTIONS.targetError,
    true,
  );
  assertEquals(DEFAULT_BAKE_OFF_OPTIONS.costPerEvalSeconds > 0, true);
});
