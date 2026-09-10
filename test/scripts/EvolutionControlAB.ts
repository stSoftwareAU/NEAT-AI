/**
 * Arithmetic of the evolution-control A/B harness (Issue #3931).
 *
 * The harness produces the committed evidence, so its arithmetic has to be
 * right for the evidence to mean anything: a corpus that is not reproducible
 * from its seed makes "same-seed A/B" a false claim, and a cost accounting that
 * charges a cheap evaluation the price of an exact one inverts the equal-budget
 * comparison the whole result rests on.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  type ABSettings,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  exactSubsetIndices,
  runArm,
  scoreAtBudget,
  scoreGenome,
} from "../../scripts/lib/evolutionControlAB.ts";
import { EvolutionControl } from "@neat/EvolutionControl.ts";
import { resolveEvolutionControlConfig } from "@config/EvolutionControlConfig.ts";

/** A small, fast configuration; `generations` still clears the issue's 50. */
const SETTINGS: ABSettings = {
  ...DEFAULT_AB_SETTINGS,
  corpusRecords: 400,
  populationSize: 8,
  generations: 50,
};

Deno.test("evolution control A/B — the corpus is reproducible from its seed", () => {
  const first = buildCorpus(SETTINGS);
  const second = buildCorpus(SETTINGS);
  assertEquals(first.truth, second.truth);
  assertEquals(first.records.length, SETTINGS.corpusRecords);
  assertEquals(first.records[7], second.records[7]);

  const different = buildCorpus({ ...SETTINGS, seed: SETTINGS.seed + 1 });
  assert(
    different.truth[0] !== first.truth[0],
    "a different seed must produce a different corpus",
  );
});

Deno.test("evolution control A/B — a genome closer to the truth scores higher", () => {
  const { records, truth } = buildCorpus(SETTINGS);
  const wrong = truth.map((weight) => weight + 3);
  assert(
    scoreGenome(truth, records, 1) > scoreGenome(wrong, records, 1),
    "the generating weights must beat a badly wrong genome",
  );
});

Deno.test("evolution control A/B — a strided score approximates the full-corpus score", () => {
  const { records, truth } = buildCorpus(SETTINGS);
  const exact = scoreGenome(truth, records, 1);
  const cheap = scoreGenome(truth, records, 20);
  // Close, but not the same number — which is the whole point of the issue.
  assertAlmostEquals(cheap, exact, 2);
  assert(cheap !== exact, "a sub-sample must not reproduce the exact score");
});

Deno.test("evolution control A/B — a phase change moves the cheap score", () => {
  const { records, truth } = buildCorpus(SETTINGS);
  assert(
    scoreGenome(truth, records, 20, 0) !== scoreGenome(truth, records, 20, 1),
    "two phases of the same stride must score different slices",
  );
});

Deno.test("evolution control A/B — a stride that scores nothing fails loud", () => {
  const { records, truth } = buildCorpus(SETTINGS);
  assertThrows(
    () => scoreGenome(truth, records, 1, records.length),
    Error,
    "scored no records",
  );
});

Deno.test("evolution control A/B — the exact subset comes from the shipped policy", () => {
  const control = new EvolutionControl(
    resolveEvolutionControlConfig({
      strategy: "individual",
      exactTopK: 2,
      diverseSampleSize: 1,
    }),
  );
  // Scores in population order; the best two are indices 3 and 1.
  const indices = exactSubsetIndices(control, [0.1, 0.8, 0.2, 0.9, 0.3]);
  assertEquals(indices.slice(0, 2), [3, 1]);
  assertEquals(indices.length, 3);
  assertEquals(new Set(indices).size, 3);
});

Deno.test("evolution control A/B — the control arm pays for an exact evaluation every creature, every generation", () => {
  const { records } = buildCorpus(SETTINGS);
  const result = runArm("none", { strategy: "none" }, records, SETTINGS);
  assertEquals(
    result.exactEvaluations,
    SETTINGS.generations * SETTINGS.populationSize,
  );
  assertEquals(result.approximateEvaluations, 0);
  assertEquals(
    result.recordsScored,
    result.exactEvaluations * SETTINGS.corpusRecords,
  );
  // Nothing was approximated, so there is nothing for the canary to read.
  assertEquals(result.canaryDivergences.length, 0);
  assertEquals(result.escalatedGeneration, null);
});

Deno.test("evolution control A/B — a cheap arm reaches the same generation count for fewer records", () => {
  const { records } = buildCorpus(SETTINGS);
  const control = runArm("none", { strategy: "none" }, records, SETTINGS);
  const cheap = runArm(
    "generation",
    { strategy: "generation", exactEvery: 5 },
    records,
    SETTINGS,
  );
  assertEquals(cheap.generations, control.generations);
  assert(
    cheap.recordsScored < control.recordsScored,
    `cheap arm cost ${cheap.recordsScored}, control ${control.recordsScored}`,
  );
  assert(cheap.approximateEvaluations > 0, "the cheap arm must run cheaply");
});

Deno.test("evolution control A/B — an arm is judged on an exact score, never a cheap one", () => {
  const { records } = buildCorpus(SETTINGS);
  const result = runArm(
    "generation",
    { strategy: "generation", exactEvery: 5 },
    records,
    SETTINGS,
  );
  // The reported endpoint is the incumbent re-scored over the whole corpus, so
  // it must be reproducible by an independent exact evaluation — the last
  // incumbent trace entry is that same exact score.
  const last = result.incumbentTrace[result.incumbentTrace.length - 1];
  assertEquals(result.finalExactScore, last);
});

Deno.test("evolution control A/B — an arm is reproducible from its seed", () => {
  const { records } = buildCorpus(SETTINGS);
  const config = { strategy: "generation" as const, exactEvery: 5 };
  const first = runArm("generation", config, records, SETTINGS);
  const second = runArm("generation", config, records, SETTINGS);
  assertEquals(first.finalExactScore, second.finalExactScore);
  assertEquals(first.recordsScored, second.recordsScored);
  assertEquals(first.escalatedGeneration, second.escalatedGeneration);
});

Deno.test("evolution control A/B — the budget read never reports a score the arm had not reached", () => {
  const { records } = buildCorpus(SETTINGS);
  const result = runArm("none", { strategy: "none" }, records, SETTINGS);
  // Before the first generation finished, no exact score existed.
  assertEquals(scoreAtBudget(result, 0), null);
  // At the full cost, the read is the final incumbent.
  assertEquals(
    scoreAtBudget(result, result.recordsScored),
    result.incumbentTrace[result.incumbentTrace.length - 1],
  );
  // Half-way through, the read is no better than the endpoint.
  const half = scoreAtBudget(result, result.recordsScored / 2);
  assert(half !== null && half <= result.finalExactScore, `half was ${half}`);
});
