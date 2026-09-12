/**
 * Where abandoned creatures land in the breeding sort (Issue #3928).
 *
 * The rule under test: an abandoned creature ranks below every usably-scored
 * creature and is ordered among its peers by partial error. The degenerate
 * cases matter most — a fully-scored creature can carry `-Infinity` (the score
 * `Fitness` assigns when the scorer reports a non-finite error), and nothing
 * ranks below that.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import {
  RACING_ABANDON_RANK_GAP,
  rankAbandonedBelowScored,
} from "../../src/score/RacingRanking.ts";
import { buildForwardOnlyPopulation } from "./_racingFixtures.ts";

Deno.test("RacingRanking - abandoned creatures sit below every finite score", () => {
  const population = buildForwardOnlyPopulation(4);
  population[0].score = 0.9;
  population[1].score = 0.5;
  const assigned = rankAbandonedBelowScored(population, [
    {
      creature: population[2],
      partialError: 0.8,
      recordsScored: 200,
      corpusRecords: 1000,
    },
    {
      creature: population[3],
      partialError: 0.4,
      recordsScored: 300,
      corpusRecords: 1000,
    },
  ]);

  assertEquals(assigned.length, 2);
  for (const creature of [population[2], population[3]]) {
    assert(
      creature.score! < 0.5,
      `abandoned score ${creature.score} must be below the worst finite score`,
    );
  }
  // Ordered by partial error: 0.4 beats 0.8.
  assert(population[3].score! > population[2].score!);
  assertAlmostEquals(
    population[3].score! - population[2].score!,
    RACING_ABANDON_RANK_GAP,
    RACING_ABANDON_RANK_GAP * 1e-6,
  );
  assertEquals(getTag(population[3], "racing"), "abandoned 300/1000");
  assertEquals(getTag(population[2], "error"), "0.8");
});

Deno.test("RacingRanking - a fully-scored failure still outranks nothing above it", () => {
  const population = buildForwardOnlyPopulation(3);
  population[0].score = 0.7;
  // A fully-scored creature whose scoring failed: `Fitness` writes -Infinity.
  population[1].score = -Infinity;
  rankAbandonedBelowScored(population, [{
    creature: population[2],
    partialError: 0.9,
    recordsScored: 500,
    corpusRecords: 1000,
  }]);

  assert(
    population[2].score! < population[0].score!,
    "the abandoned creature ranks below the usable score",
  );
  assert(
    population[2].score! > population[1].score!,
    "nothing can rank below an outright scoring failure",
  );
});

Deno.test("RacingRanking - a generation of failures does not promote the abandoned", () => {
  const population = buildForwardOnlyPopulation(3);
  population[0].score = -Infinity;
  population[1].score = -Infinity;
  rankAbandonedBelowScored(population, [{
    creature: population[2],
    partialError: 0.9,
    recordsScored: 500,
    corpusRecords: 1000,
  }]);

  assertEquals(
    population[2].score,
    -Infinity,
    "with no usable score to sit under, the abandoned creature must not " +
      "become the top of a dead generation",
  );
  assertEquals(getTag(population[2], "racing"), "abandoned 500/1000");
});

Deno.test("RacingRanking - no abandoned creatures leaves every score untouched", () => {
  const population = buildForwardOnlyPopulation(2);
  population[0].score = 0.4;
  population[1].score = 0.3;
  assertEquals(rankAbandonedBelowScored(population, []), []);
  assertEquals(population[0].score, 0.4);
  assertEquals(population[1].score, 0.3);
});
