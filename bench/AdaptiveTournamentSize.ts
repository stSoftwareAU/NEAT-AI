/**
 * Benchmark for adaptive tournament selection (Issue #1019).
 *
 * This benchmark demonstrates:
 * 1. Selection pressure improvement with adaptive tournament size
 * 2. Coverage percentage comparison (fixed 5 vs adaptive)
 * 3. Selection efficiency (time per selection)
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/AdaptiveTournamentSize.ts
 */
import { addTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil } from "../mod.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { FitnessRanking } from "../src/breed/FitnessRanking.ts";
import { calculateAdaptiveTournamentSize } from "../src/breed/AdaptiveTournamentSize.ts";

/**
 * Creates a population of specified size with sequential scores.
 */
function createPopulationOfSize(size: number): Creature[] {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < size; i++) {
    population.push({
      input: 1,
      output: 1,
      score: size - i, // Descending scores (best first)
      neurons: [],
      synapses: [],
    });
  }

  const creatures: Creature[] = [];
  population.forEach((ni, idx) => {
    ni.neurons.push({
      index: 1,
      type: "output",
      squash: "IDENTITY",
      bias: idx * 0.001,
    });
    ni.synapses.push({
      from: 0,
      to: 1,
      weight: 1 + idx * 0.001,
    });
    const creature = Creature.fromJSON(ni);
    CreatureUtil.makeUUID(creature);
    creature.score = ni.score;
    addTag(creature, "score", ni.score!.toString());
    creatures.push(creature);
  });
  return creatures;
}

// Create populations of different sizes
const smallPopulation = createPopulationOfSize(50);
const mediumPopulation = createPopulationOfSize(200);
const largePopulation = createPopulationOfSize(1000);

const smallRanking = new FitnessRanking(smallPopulation);
const mediumRanking = new FitnessRanking(mediumPopulation);
const largeRanking = new FitnessRanking(largePopulation);

// Constants
const FIXED_TOURNAMENT_SIZE = 5;
const PROBABILITY = 0.5;
const SELECTIONS_PER_ITER = 100;

// Display coverage statistics
console.log("\n=== Tournament Size Coverage Comparison ===");
console.log("\nPopulation | Fixed (5) | Adaptive   | Coverage Improvement");
console.log("-----------|-----------|------------|---------------------");

for (
  const [name, pop] of [
    ["50", smallPopulation],
    ["200", mediumPopulation],
    ["1000", largePopulation],
  ] as [string, Creature[]][]
) {
  const adaptiveSize = calculateAdaptiveTournamentSize(pop.length);
  const fixedCoverage = (FIXED_TOURNAMENT_SIZE / pop.length * 100).toFixed(2);
  const adaptiveCoverage = (adaptiveSize / pop.length * 100).toFixed(2);
  const improvement = (
    (adaptiveSize / FIXED_TOURNAMENT_SIZE - 1) * 100
  ).toFixed(1);
  console.log(
    `${name.padEnd(10)} | ${FIXED_TOURNAMENT_SIZE.toString().padEnd(9)} | ${
      adaptiveSize.toString().padEnd(10)
    } | ${fixedCoverage}% -> ${adaptiveCoverage}% (+${improvement}%)`,
  );
}

// Selection pressure benchmark - measure average rank of selected creatures
console.log("\n=== Selection Pressure Analysis ===");

function measureSelectionPressure(
  ranking: FitnessRanking,
  tournamentSize: number,
  iterations: number,
): { avgRank: number; stdDev: number } {
  const ranks: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const selected = ranking.selectTournament(tournamentSize, PROBABILITY);
    const rank = ranking.sortedPopulation.findIndex((c) =>
      c.uuid === selected.uuid
    );
    ranks.push(rank);
  }

  const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const variance = ranks.reduce((sum, r) => sum + (r - avgRank) ** 2, 0) /
    ranks.length;
  const stdDev = Math.sqrt(variance);

  return { avgRank, stdDev };
}

console.log("\nPopulation | Fixed Avg Rank | Adaptive Avg Rank | Improvement");
console.log("-----------|----------------|-------------------|------------");

for (
  const [name, ranking] of [
    ["50", smallRanking],
    ["200", mediumRanking],
    ["1000", largeRanking],
  ] as [string, FitnessRanking][]
) {
  const adaptiveSize = calculateAdaptiveTournamentSize(
    ranking.sortedPopulation.length,
  );

  const fixedPressure = measureSelectionPressure(
    ranking,
    FIXED_TOURNAMENT_SIZE,
    1000,
  );
  const adaptivePressure = measureSelectionPressure(
    ranking,
    adaptiveSize,
    1000,
  );

  const improvement = (
    (1 - adaptivePressure.avgRank / fixedPressure.avgRank) * 100
  ).toFixed(1);
  console.log(
    `${name.padEnd(10)} | ${fixedPressure.avgRank.toFixed(1).padStart(14)} | ${
      adaptivePressure.avgRank.toFixed(1).padStart(17)
    } | ${improvement.padStart(10)}% better`,
  );
}

console.log("\n=== Running Benchmarks ===\n");

// Benchmarks for selection speed
Deno.bench({
  name: "Fixed size (5) - 50 pop",
  group: "Small Population (50)",
  baseline: true,
  fn() {
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      smallRanking.selectTournament(FIXED_TOURNAMENT_SIZE, PROBABILITY);
    }
  },
});

Deno.bench({
  name: "Adaptive size - 50 pop",
  group: "Small Population (50)",
  fn() {
    const adaptiveSize = calculateAdaptiveTournamentSize(50);
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      smallRanking.selectTournament(adaptiveSize, PROBABILITY);
    }
  },
});

Deno.bench({
  name: "Fixed size (5) - 200 pop",
  group: "Medium Population (200)",
  baseline: true,
  fn() {
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      mediumRanking.selectTournament(FIXED_TOURNAMENT_SIZE, PROBABILITY);
    }
  },
});

Deno.bench({
  name: "Adaptive size - 200 pop",
  group: "Medium Population (200)",
  fn() {
    const adaptiveSize = calculateAdaptiveTournamentSize(200);
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      mediumRanking.selectTournament(adaptiveSize, PROBABILITY);
    }
  },
});

Deno.bench({
  name: "Fixed size (5) - 1000 pop",
  group: "Large Population (1000)",
  baseline: true,
  fn() {
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      largeRanking.selectTournament(FIXED_TOURNAMENT_SIZE, PROBABILITY);
    }
  },
});

Deno.bench({
  name: "Adaptive size - 1000 pop",
  group: "Large Population (1000)",
  fn() {
    const adaptiveSize = calculateAdaptiveTournamentSize(1000);
    for (let i = 0; i < SELECTIONS_PER_ITER; i++) {
      largeRanking.selectTournament(adaptiveSize, PROBABILITY);
    }
  },
});
