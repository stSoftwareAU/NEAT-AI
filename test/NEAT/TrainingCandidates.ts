/**
 * Issue #2791: tests for {@link selectTrainingCandidates}.
 *
 * The per-generation training loop must be able to train up to `trainPerGen`
 * creatures from the score-sorted population — not just the elitist slice — so
 * raising `trainPerGen` actually increases gradient coverage.
 */

import { assertEquals } from "@std/assert";
import type { Creature } from "@creature";
import { selectTrainingCandidates } from "@neat/TrainingCandidates.ts";

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
