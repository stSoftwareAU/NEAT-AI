/**
 * Issue #2791: tests for {@link selectTrainingCandidates}.
 *
 * The per-generation training loop must be able to train up to `trainPerGen`
 * creatures from the score-sorted population — not just the elitist slice — so
 * raising `trainPerGen` actually increases gradient coverage.
 */

import { assertEquals } from "@std/assert";
import type { Creature } from "@creature";
import {
  countRankableCreatures,
  selectRankedTrainingCandidates,
  selectTrainingCandidates,
} from "@neat/TrainingCandidates.ts";

/** Minimal creature stub: the selector only reads `score` and `uuid`. */
function creature(uuid: string, score: number): Creature {
  return { uuid, score } as unknown as Creature;
}

/** A score-sorted (descending) population of five creatures. */
function population(): Creature[] {
  return [
    creature("a", 0.9),
    creature("b", 0.8),
    creature("c", 0.7),
    creature("d", 0.6),
    creature("e", 0.5),
  ];
}

Deno.test("selectTrainingCandidates - returns the top `limit` creatures in order", () => {
  const result = selectTrainingCandidates(population(), 3);
  assertEquals(result.map((c) => c.uuid), ["a", "b", "c"]);
});

Deno.test("selectTrainingCandidates - limit of 1 trains only the fittest (legacy default behaviour)", () => {
  const result = selectTrainingCandidates(population(), 1);
  assertEquals(result.map((c) => c.uuid), ["a"]);
});

Deno.test("selectTrainingCandidates - limit above population size returns the whole population", () => {
  const result = selectTrainingCandidates(population(), 99);
  assertEquals(result.length, 5);
});

Deno.test("selectTrainingCandidates - limit of 0 returns no candidates (evolution-only)", () => {
  assertEquals(selectTrainingCandidates(population(), 0), []);
});

Deno.test("selectTrainingCandidates - negative limit returns no candidates", () => {
  assertEquals(selectTrainingCandidates(population(), -5), []);
});

Deno.test("selectTrainingCandidates - skips creatures with non-finite scores", () => {
  const pop = [
    creature("a", Number.POSITIVE_INFINITY),
    creature("b", 0.8),
    creature("c", Number.NEGATIVE_INFINITY),
    creature("d", Number.NaN),
    creature("e", 0.5),
  ];
  // Only finite-score creatures are viable training targets.
  const result = selectTrainingCandidates(pop, 5);
  assertEquals(result.map((c) => c.uuid), ["b", "e"]);
});

Deno.test("selectTrainingCandidates - empty population returns no candidates", () => {
  assertEquals(selectTrainingCandidates([], 3), []);
});

/**
 * Issue #3934: the same rule, reporting the rank it selected at.
 *
 * The rank is the column the memetic-budget question is asked of — "does
 * present fitness predict what a gradient step realises" — so it must be the
 * position among the creatures the rule could have chosen, not the array index
 * it happened to read.
 */
Deno.test("selectRankedTrainingCandidates - ranks from the fittest down", () => {
  const result = selectRankedTrainingCandidates(population(), 3);
  assertEquals(result.map((c) => c.creature.uuid), ["a", "b", "c"]);
  assertEquals(result.map((c) => c.rank), [0, 1, 2]);
});

Deno.test("selectRankedTrainingCandidates - selects exactly what the unranked rule selects", () => {
  for (const limit of [0, 1, 3, 5, 99]) {
    const pop = population();
    assertEquals(
      selectRankedTrainingCandidates(pop, limit).map((c) => c.creature),
      selectTrainingCandidates(pop, limit),
      `limit ${limit} must select the same creatures`,
    );
  }
});

Deno.test("selectRankedTrainingCandidates - a skipped non-finite score consumes no rank", () => {
  const pop = [
    creature("a", 0.9),
    creature("b", Number.NEGATIVE_INFINITY),
    creature("c", 0.7),
    creature("d", Number.NaN),
    creature("e", 0.5),
  ];
  const result = selectRankedTrainingCandidates(pop, 3);
  assertEquals(result.map((c) => c.creature.uuid), ["a", "c", "e"]);
  assertEquals(result.map((c) => c.rank), [0, 1, 2]);
});

Deno.test("selectRankedTrainingCandidates - no candidates for a non-positive limit", () => {
  assertEquals(selectRankedTrainingCandidates(population(), 0), []);
  assertEquals(selectRankedTrainingCandidates(population(), -2), []);
});

Deno.test("countRankableCreatures - counts only the creatures the rule could choose", () => {
  assertEquals(countRankableCreatures(population()), 5);
  assertEquals(
    countRankableCreatures([
      creature("a", 0.9),
      creature("b", Number.NEGATIVE_INFINITY),
      creature("c", Number.NaN),
    ]),
    1,
  );
  assertEquals(countRankableCreatures([]), 0);
});
