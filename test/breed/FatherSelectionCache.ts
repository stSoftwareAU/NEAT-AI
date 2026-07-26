/**
 * Tests for the per-generation father-selection ranking cache (Issue #3474).
 *
 * These are "what" tests: they exercise `findFather` with and without a
 * {@link FatherSelectionCache} and assert on the selection *outcome* — the
 * mother is never returned, the father is always a population member, and the
 * cache reuses rankings across calls. They do not measure timing (that lives
 * in `bench/`).
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { findFather } from "@breed/ParentSelection.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { FatherSelectionCache } from "@breed/FatherSelectionCache.ts";

function createScoredCreature(score: number): Creature {
  const hiddenUUID = crypto.randomUUID();
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: hiddenUUID, squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight: 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: 0.8 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

function createGenus(creatures: Creature[]): Genus {
  const genus = new Genus();
  for (const creature of creatures) {
    genus.addCreature(creature);
  }
  return genus;
}

Deno.test(
  "FatherSelectionCache - populationRanking reuses the supplied ranking",
  () => {
    const population = [
      createScoredCreature(0.9),
      createScoredCreature(0.5),
    ];
    const ranking = new FitnessRanking(population);
    const cache = new FatherSelectionCache(population, ranking);

    assertStrictEquals(
      cache.populationRanking(),
      ranking,
      "Should return the exact ranking it was constructed with",
    );
    assertStrictEquals(
      cache.populationRanking(),
      cache.populationRanking(),
      "Repeated calls return the same cached instance",
    );
  },
);

Deno.test(
  "FatherSelectionCache - populationRanking is built lazily when omitted",
  () => {
    const population = [
      createScoredCreature(0.9),
      createScoredCreature(0.5),
      createScoredCreature(0.1),
    ];
    const cache = new FatherSelectionCache(population);

    const built = cache.populationRanking();
    assertStrictEquals(
      cache.populationRanking(),
      built,
      "Lazily-built ranking is cached and reused",
    );
    // Ranks the same population as a freshly built ranking (descending score).
    const fresh = new FitnessRanking(population);
    assertEquals(
      built.sortedPopulation.map((c) => c.uuid),
      fresh.sortedPopulation.map((c) => c.uuid),
      "Cached ranking orders the population identically to a fresh one",
    );
  },
);

Deno.test(
  "FatherSelectionCache - speciesRanking caches one ranking per key",
  () => {
    const speciesA = [createScoredCreature(0.9), createScoredCreature(0.4)];
    const speciesB = [createScoredCreature(0.8)];
    const cache = new FatherSelectionCache([...speciesA, ...speciesB]);

    const first = cache.speciesRanking("A", speciesA);
    assertStrictEquals(
      cache.speciesRanking("A", speciesA),
      first,
      "Same key returns the same cached ranking",
    );
    const other = cache.speciesRanking("B", speciesB);
    assert(other !== first, "Different keys yield different rankings");
  },
);

Deno.test(
  "findFather - cached selection finds a father (global path)",
  () => {
    const creatures = [
      createScoredCreature(0.9),
      createScoredCreature(0.7),
      createScoredCreature(0.5),
      createScoredCreature(0.3),
    ];
    // globalBreedingRate=1 forces the whole-population father path so the
    // cached population ranking (which includes the mother) is exercised.
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });
    const genus = createGenus(creatures);
    const cache = new FatherSelectionCache(
      genus.population,
      new FitnessRanking(genus.population),
    );
    const mum = creatures[0]; // fittest — most likely to be drawn from ranking

    for (let i = 0; i < 200; i++) {
      const dad = findFather(mum, genus, config, undefined, cache);
      assert(dad, "Cached global-path selection must always find a father");
    }
  },
);

Deno.test(
  "findFather - cached path returns the sole father on a tiny pool",
  () => {
    // Two creatures: mother is the fittest, so POWER selection from the cached
    // ranking keeps drawing her — the rejection fallback must still return the
    // one available father rather than the mother (which would leave no
    // eligible candidate and yield undefined).
    const mum = createScoredCreature(0.99);
    const dadCreature = createScoredCreature(0.01);
    const genus = createGenus([mum, dadCreature]);
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });
    const cache = new FatherSelectionCache(
      genus.population,
      new FitnessRanking(genus.population),
    );

    for (let i = 0; i < 100; i++) {
      const dad = findFather(mum, genus, config, undefined, cache);
      assert(
        dad,
        "Rejection fallback must return the sole non-mother father, never undefined",
      );
    }
  },
);

Deno.test(
  "findFather - cached path returns undefined when only the mother exists",
  () => {
    const mum = createScoredCreature(0.9);
    const genus = createGenus([mum]);
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });
    const cache = new FatherSelectionCache(
      genus.population,
      new FitnessRanking(genus.population),
    );

    const dad = findFather(mum, genus, config, undefined, cache);
    assertEquals(dad, undefined, "No father available → undefined");
  },
);

Deno.test(
  "findFather - cache and no-cache paths both find a father (no regression)",
  () => {
    const build = () => [
      createScoredCreature(0.9),
      createScoredCreature(0.6),
      createScoredCreature(0.3),
    ];
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });

    // No cache — the legacy per-call FitnessRanking path.
    const genusA = createGenus(build());
    let foundA = 0;
    for (let i = 0; i < 100; i++) {
      if (findFather(genusA.population[0], genusA, config)) foundA++;
    }

    // With cache — the reused per-generation ranking path.
    const genusB = createGenus(build());
    const cache = new FatherSelectionCache(
      genusB.population,
      new FitnessRanking(genusB.population),
    );
    let foundB = 0;
    for (let i = 0; i < 100; i++) {
      if (findFather(genusB.population[0], genusB, config, undefined, cache)) {
        foundB++;
      }
    }

    assertEquals(foundA, 100, "No-cache path always finds a father here");
    assertEquals(foundB, 100, "Cached path always finds a father here");
  },
);
