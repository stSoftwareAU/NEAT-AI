/**
 * `NeatOptions.evolutionControl` reaching the evolution loop (Issue #3931).
 *
 * The policy object is only worth having if it is actually consulted, so the
 * seams tested here are config → `Neat`, and the one place in the build that
 * already produces an approximate score — a creature racing abandoned
 * mid-corpus (Issue #3928) — reaching the guards that must refuse it.
 *
 * The `"none"` case is the important one: with the default strategy no creature
 * may acquire a fidelity tag at all, so a default run's exported creatures are
 * unchanged by this issue.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Neat } from "@neat/Neat.ts";
import { getTag } from "@stsoftware/tags/mod";
import { rankAbandonedBelowScored } from "../../src/score/RacingRanking.ts";
import {
  refreshExactScoreFidelity,
  SCORE_FIDELITY_TAG,
  scoreFidelity,
} from "@architecture/ScoreFidelity.ts";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { buildForwardOnlyPopulation } from "../score/_racingFixtures.ts";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

Deno.test("evolution control wiring — a default Neat runs the policy off", () => {
  const neat = new Neat(2, 1, { populationSize: 4 }, []);
  assertEquals(neat.config.evolutionControl.strategy, "none");
  assertEquals(neat.evolutionControl.strategy, "none");
  assertEquals(neat.evolutionControl.active, false);
  assertEquals(neat.evolutionControl.beginGeneration(7).exactSweep, true);
});

Deno.test("evolution control wiring — a requested strategy reaches the policy object", () => {
  const neat = new Neat(2, 1, {
    populationSize: 4,
    evolutionControl: { strategy: "generation", exactEvery: 3 },
  }, []);
  assertEquals(neat.evolutionControl.strategy, "generation");
  assertEquals(neat.evolutionControl.active, true);
  assertEquals(neat.evolutionControl.beginGeneration(1).exactSweep, true);
  assertEquals(neat.evolutionControl.beginGeneration(2).exactSweep, false);
  assertEquals(neat.evolutionControl.beginGeneration(3).exactSweep, true);
});

Deno.test("evolution control wiring — an invalid strategy fails the run, not the generation", () => {
  assertThrows(
    () =>
      new Neat(2, 1, {
        populationSize: 4,
        evolutionControl: { exactEvery: 0 },
      }, []),
    ConfigurationError,
  );
});

Deno.test("evolution control wiring — a racing-abandoned creature carries its partial fidelity", () => {
  const population = buildForwardOnlyPopulation(3);
  population[0].score = 0.9;
  population[1].score = 0.5;
  rankAbandonedBelowScored(population, [{
    creature: population[2],
    partialError: 0.8,
    recordsScored: 250,
    corpusRecords: 1000,
  }]);

  assertEquals(scoreFidelity(population[2]), 0.25);
  // The creatures that finished the corpus were never approximated.
  for (const creature of [population[0], population[1]]) {
    assertEquals(getTag(creature, SCORE_FIDELITY_TAG), null);
  }
});

Deno.test("evolution control wiring — an abandoned creature is refused every exact-only slot", () => {
  const neat = new Neat(2, 1, {
    populationSize: 4,
    evolutionControl: { strategy: "generation" },
  }, []);
  const population = buildForwardOnlyPopulation(3);
  population[0].score = 0.9;
  population[1].score = 0.5;
  rankAbandonedBelowScored(population, [{
    creature: population[2],
    partialError: 0.8,
    recordsScored: 100,
    corpusRecords: 1000,
  }]);

  const abandoned = population[2];
  for (const slot of ["elitism", "previousFittest", "export"]) {
    const error = assertThrows(
      () => neat.evolutionControl.assertExact(abandoned, slot),
      EvolutionControlError,
    );
    assertEquals(error.reason, "APPROXIMATE_SCORE");
    assert(error.message.includes(slot), error.message);
  }
  // And the fully-scored creatures pass the same guards untouched.
  neat.evolutionControl.assertExactAll(
    [population[0], population[1]],
    "elitism",
  );
});

Deno.test("evolution control wiring — a full-corpus rescore clears the stale fidelity", () => {
  const population = buildForwardOnlyPopulation(3);
  population[0].score = 0.9;
  population[1].score = 0.5;
  rankAbandonedBelowScored(population, [{
    creature: population[2],
    partialError: 0.8,
    recordsScored: 100,
    corpusRecords: 1000,
  }]);

  // The next generation scores it over the whole corpus, exactly as
  // `Fitness` does on both the batch and the per-creature path.
  refreshExactScoreFidelity(population[2]);
  assertEquals(scoreFidelity(population[2]), 1);
  new Neat(2, 1, { populationSize: 4 }, []).evolutionControl
    .assertExact(population[2], "elitism");
});

Deno.test("evolution control wiring — a default evolve tags nothing and plans every generation exact", async () => {
  await withRngTestLock(async () => {
    const previousRng = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(3931));
      const trainingSet = [
        { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
        { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
        { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
        { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
      ];
      const creature = new Creature(2, 1);
      const result = await creature.evolveDataSet(trainingSet, {
        mutation: Mutation.FFW,
        elitism: 4,
        mutationRate: 0.5,
        populationSize: 20,
        iterations: 12,
        threads: 1,
      });

      // The run completed — so no exact-only guard fired on the elite band,
      // `previousFittest`, or the export during any of its generations.
      assert(Number.isFinite(result.error), `error was ${result.error}`);
      // And no creature acquired a fidelity tag, so the exported creature is
      // exactly what the build produced before Issue #3931.
      assertEquals(getTag(creature, SCORE_FIDELITY_TAG), null);
      assertEquals(scoreFidelity(creature), null);
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});
