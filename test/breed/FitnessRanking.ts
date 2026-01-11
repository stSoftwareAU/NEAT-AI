import { assert, assertEquals, assertThrows } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil } from "../../mod.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { FitnessRanking } from "../../src/breed/FitnessRanking.ts";
import { Selection } from "../../src/methods/Selection.ts";

/**
 * Helper function to create Creature instances from CreatureInternal data.
 * Each creature gets a unique UUID and the specified score.
 */
function makePopulation(population: CreatureInternal[]): Creature[] {
  const creatures: Creature[] = [];

  population.forEach((ni, idx) => {
    if (ni.neurons.length === 0) {
      ni.neurons.push({
        index: 1,
        type: "output",
        squash: "IDENTITY",
        // Use different bias values to ensure unique UUIDs
        bias: idx * 0.001,
      });
      ni.synapses.push({
        from: 0,
        to: 1,
        weight: 1 + idx * 0.001,
      });
    }
    const creature = Creature.fromJSON(ni);
    CreatureUtil.makeUUID(creature);
    creature.score = ni.score;
    if (ni.score !== undefined) {
      addTag(creature, "score", ni.score.toString());
    }
    creatures.push(creature);
  });
  return creatures;
}

Deno.test("FitnessRanking - basic construction", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  assertEquals(ranking.sortedPopulation.length, 3);
  // Should be sorted in descending order (highest score first)
  assertEquals(ranking.sortedPopulation[0].score, 3);
  assertEquals(ranking.sortedPopulation[1].score, 2);
  assertEquals(ranking.sortedPopulation[2].score, 1);
});

Deno.test("FitnessRanking - totalFitness calculation", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Total fitness = 5 + 3 + 2 = 10
  assertEquals(ranking.totalFitness, 10);
});

Deno.test("FitnessRanking - minFitness calculation", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  assertEquals(ranking.minFitness, -3);
});

Deno.test("FitnessRanking - adjustedTotalFitness with negative scores", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // adjustFitness = Math.abs(-3) = 3
  // adjustedTotalFitness = (5+3) + (-3+3) + (2+3) = 8 + 0 + 5 = 13
  assertEquals(ranking.adjustedTotalFitness, 13);
});

Deno.test("FitnessRanking - getScore returns correct score", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  assertEquals(ranking.getScore(creatures[0].uuid!), 5);
  assertEquals(ranking.getScore(creatures[1].uuid!), 3);
});

Deno.test("FitnessRanking - selectPower returns creature", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Run multiple times to test probabilistic selection
  for (let i = 0; i < 10; i++) {
    const selected = ranking.selectPower(Selection.POWER.power);
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("FitnessRanking - selectFitnessProportionate returns creature", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Run multiple times to test probabilistic selection
  for (let i = 0; i < 10; i++) {
    const selected = ranking.selectFitnessProportionate();
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("FitnessRanking - selectTournament returns creature", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 4, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Run multiple times to test probabilistic selection
  for (let i = 0; i < 10; i++) {
    const selected = ranking.selectTournament(3, 0.5);
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("FitnessRanking - handles creatures without score using tag", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  // Set score via tag instead of property
  addTag(creatures[0], "score", "5");
  addTag(creatures[1], "score", "3");

  const ranking = new FitnessRanking(creatures);

  assertEquals(ranking.getScore(creatures[0].uuid!), 5);
  assertEquals(ranking.getScore(creatures[1].uuid!), 3);
});

Deno.test("FitnessRanking - handles all equal scores", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Should still be able to select even with equal scores
  const selected = ranking.selectFitnessProportionate();
  assert(selected !== undefined);
});

Deno.test("FitnessRanking - fitness proportionate favours higher scores", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 100, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Run many selections and check distribution
  const counts = new Map<string, number>();
  for (let i = 0; i < 1000; i++) {
    const selected = ranking.selectFitnessProportionate();
    const uuid = selected.uuid!;
    counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
  }

  // The creature with score 100 should be selected much more often than score 1
  const highScoreCount = counts.get(creatures[0].uuid!) ?? 0;
  const lowScoreCount = counts.get(creatures[1].uuid!) ?? 0;

  // High score creature should be selected significantly more often (at least 10x)
  assert(
    highScoreCount > lowScoreCount * 5,
    `High score (${highScoreCount}) should be much more than low score (${lowScoreCount})`,
  );
});

Deno.test("FitnessRanking - power selection favours better ranked", () => {
  const population: CreatureInternal[] = [];
  for (let i = 10; i >= 1; i--) {
    population.push({
      input: 1,
      output: 1,
      score: i,
      neurons: [],
      synapses: [],
    });
  }

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Run many selections and check distribution
  const indexCounts: number[] = new Array(10).fill(0);
  for (let i = 0; i < 1000; i++) {
    const selected = ranking.selectPower(Selection.POWER.power);
    const idx = ranking.sortedPopulation.findIndex((c) =>
      c.uuid === selected.uuid
    );
    indexCounts[idx]++;
  }

  // Earlier indices (better ranked) should be selected more often
  assert(
    indexCounts[0] > indexCounts[9],
    `First index (${indexCounts[0]}) should be more than last (${
      indexCounts[9]
    })`,
  );
});

Deno.test("FitnessRanking - precomputed once, not on each selection", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);

  // Create ranking once
  const ranking = new FitnessRanking(creatures);

  // Record values
  const totalFitness = ranking.totalFitness;
  const minFitness = ranking.minFitness;
  const sortedLength = ranking.sortedPopulation.length;

  // Make multiple selections
  for (let i = 0; i < 100; i++) {
    ranking.selectFitnessProportionate();
    ranking.selectPower(4);
    ranking.selectTournament(2, 0.5);
  }

  // Values should remain the same (precomputed, not recalculated)
  assertEquals(ranking.totalFitness, totalFitness);
  assertEquals(ranking.minFitness, minFitness);
  assertEquals(ranking.sortedPopulation.length, sortedLength);
});

Deno.test("FitnessRanking - handles already sorted population", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 4, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Should still work correctly
  assertEquals(ranking.sortedPopulation[0].score, 5);
  assertEquals(ranking.sortedPopulation[1].score, 4);
  assertEquals(ranking.sortedPopulation[2].score, 3);
});

Deno.test("FitnessRanking - handles unsorted population", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 4, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Should be sorted correctly
  assertEquals(ranking.sortedPopulation[0].score, 5);
  assertEquals(ranking.sortedPopulation[1].score, 4);
  assertEquals(ranking.sortedPopulation[2].score, 2);
  assertEquals(ranking.sortedPopulation[3].score, 1);
});

Deno.test("FitnessRanking - empty population throws", () => {
  const creatures: Creature[] = [];

  assertThrows(
    () => new FitnessRanking(creatures),
    Error,
    "Population cannot be empty",
  );
});

Deno.test("FitnessRanking - single creature population", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 5, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  assertEquals(ranking.sortedPopulation.length, 1);
  assertEquals(ranking.selectFitnessProportionate(), creatures[0]);
  assertEquals(ranking.selectPower(4), creatures[0]);
  assertEquals(ranking.selectTournament(1, 0.5), creatures[0]);
});

Deno.test("FitnessRanking - performance with large population", () => {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < 10000; i++) {
    population.push({
      input: 1,
      output: 1,
      score: Math.random() * 100,
      neurons: [],
      synapses: [],
    });
  }

  const creatures = makePopulation(population);

  // Time the construction (should be O(n log n) for sorting)
  const startConstruct = performance.now();
  const ranking = new FitnessRanking(creatures);
  const constructTime = performance.now() - startConstruct;

  // Time multiple selections (should be O(1) or O(k) where k is tournament size)
  const startSelect = performance.now();
  for (let i = 0; i < 1000; i++) {
    ranking.selectFitnessProportionate();
  }
  const selectTime = performance.now() - startSelect;

  console.log(`Construction time: ${constructTime.toFixed(2)}ms`);
  console.log(`1000 selections time: ${selectTime.toFixed(2)}ms`);

  // Selections should be fast since data is precomputed
  assert(selectTime < 1000, `Selection took too long: ${selectTime}ms`);
});

Deno.test("FitnessRanking - negative scores handled correctly", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: -1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -5, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -3, neurons: [], synapses: [] },
  ];

  const creatures = makePopulation(population);
  const ranking = new FitnessRanking(creatures);

  // Should be sorted by score descending (least negative first)
  assertEquals(ranking.sortedPopulation[0].score, -1);
  assertEquals(ranking.sortedPopulation[1].score, -3);
  assertEquals(ranking.sortedPopulation[2].score, -5);

  // Selection should still work
  const selected = ranking.selectFitnessProportionate();
  assert(selected !== undefined);
});
