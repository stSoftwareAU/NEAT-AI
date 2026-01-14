/**
 * Tests for adaptive tournament selection (Issue #1019)
 *
 * Tournament selection size should scale with population size:
 * - For small populations: size is constrained to population size
 * - For larger populations: roughly sqrt(population) or 5-10% coverage
 * - Balances exploration vs exploitation
 */
import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil } from "../../mod.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { FitnessRanking } from "../../src/breed/FitnessRanking.ts";
import { calculateAdaptiveTournamentSize } from "../../src/breed/AdaptiveTournamentSize.ts";

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

/**
 * Helper to create a population of specified size with sequential scores.
 */
function createPopulationOfSize(size: number): Creature[] {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < size; i++) {
    population.push({
      input: 1,
      output: 1,
      score: size - i, // Descending scores
      neurons: [],
      synapses: [],
    });
  }
  return makePopulation(population);
}

// Tests for calculateAdaptiveTournamentSize function

Deno.test("AdaptiveTournamentSize - minimum size is 3", () => {
  // Even for very small populations, we should use at least 3
  assertEquals(calculateAdaptiveTournamentSize(1), 1); // Special case: single creature
  assertEquals(calculateAdaptiveTournamentSize(2), 2); // Special case: 2 creatures
  assertEquals(calculateAdaptiveTournamentSize(3), 3); // Minimum tournament size
  assertEquals(calculateAdaptiveTournamentSize(5), 3); // Still at minimum
});

Deno.test("AdaptiveTournamentSize - scales with sqrt for medium populations", () => {
  // sqrt(100) = 10
  const size100 = calculateAdaptiveTournamentSize(100);
  assert(size100 >= 7, `Size for 100 should be >= 7, got ${size100}`);
  assert(size100 <= 12, `Size for 100 should be <= 12, got ${size100}`);

  // sqrt(225) = 15
  const size225 = calculateAdaptiveTournamentSize(225);
  assert(size225 >= 10, `Size for 225 should be >= 10, got ${size225}`);
  assert(size225 <= 18, `Size for 225 should be <= 18, got ${size225}`);
});

Deno.test("AdaptiveTournamentSize - caps at ~10% for large populations", () => {
  // For 1000 creatures: sqrt(1000) ≈ 31.6, but 10% = 100
  // We want min(sqrt, 10%), so should be around sqrt(1000)
  const size1000 = calculateAdaptiveTournamentSize(1000);
  assert(size1000 >= 25, `Size for 1000 should be >= 25, got ${size1000}`);
  assert(size1000 <= 100, `Size for 1000 should be <= 100, got ${size1000}`);

  // For 10000 creatures: sqrt(10000) = 100, 10% = 1000
  const size10000 = calculateAdaptiveTournamentSize(10000);
  assert(size10000 >= 80, `Size for 10000 should be >= 80, got ${size10000}`);
  assert(
    size10000 <= 1000,
    `Size for 10000 should be <= 1000, got ${size10000}`,
  );
});

Deno.test("AdaptiveTournamentSize - increases monotonically", () => {
  let previousSize = 0;
  const testSizes = [10, 50, 100, 200, 500, 1000, 2000, 5000];

  for (const popSize of testSizes) {
    const tournamentSize = calculateAdaptiveTournamentSize(popSize);
    assert(
      tournamentSize >= previousSize,
      `Tournament size should not decrease: population ${popSize} got ${tournamentSize}, previous was ${previousSize}`,
    );
    previousSize = tournamentSize;
  }
});

Deno.test("AdaptiveTournamentSize - formula matches expected values", () => {
  // Test specific expected values based on the formula:
  // size = max(3, min(floor(sqrt(population)), floor(population * 0.1)))

  // Population 9: sqrt(9)=3, 10%=0.9 → min(3, 0)=0 → max(3, 0)=3
  assertEquals(calculateAdaptiveTournamentSize(9), 3);

  // Population 50: sqrt(50)≈7, 10%=5 → min(7, 5)=5 → max(3, 5)=5
  assertEquals(calculateAdaptiveTournamentSize(50), 5);

  // Population 400: sqrt(400)=20, 10%=40 → min(20, 40)=20 → max(3, 20)=20
  assertEquals(calculateAdaptiveTournamentSize(400), 20);
});

// Integration tests with FitnessRanking

Deno.test("FitnessRanking - selectTournament with adaptive size for small population", () => {
  const creatures = createPopulationOfSize(10);
  const ranking = new FitnessRanking(creatures);

  const adaptiveSize = calculateAdaptiveTournamentSize(creatures.length);

  // Run multiple selections and verify they work correctly
  for (let i = 0; i < 20; i++) {
    const selected = ranking.selectTournament(adaptiveSize, 0.5);
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("FitnessRanking - selectTournament with adaptive size for medium population", () => {
  const creatures = createPopulationOfSize(100);
  const ranking = new FitnessRanking(creatures);

  const adaptiveSize = calculateAdaptiveTournamentSize(creatures.length);
  assert(
    adaptiveSize > 5,
    `Expected adaptive size > 5 for 100 creatures, got ${adaptiveSize}`,
  );

  // Run multiple selections and verify they work correctly
  for (let i = 0; i < 20; i++) {
    const selected = ranking.selectTournament(adaptiveSize, 0.5);
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("FitnessRanking - selectTournament with adaptive size for large population", () => {
  const creatures = createPopulationOfSize(1000);
  const ranking = new FitnessRanking(creatures);

  const adaptiveSize = calculateAdaptiveTournamentSize(creatures.length);
  assert(
    adaptiveSize > 20,
    `Expected adaptive size > 20 for 1000 creatures, got ${adaptiveSize}`,
  );

  // Run multiple selections and verify they work correctly
  for (let i = 0; i < 20; i++) {
    const selected = ranking.selectTournament(adaptiveSize, 0.5);
    assert(selected !== undefined);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});

Deno.test("AdaptiveTournament - larger tournaments favour fitter creatures", () => {
  const creatures = createPopulationOfSize(100);
  const ranking = new FitnessRanking(creatures);

  const smallTournamentSize = 3;
  const largeTournamentSize = calculateAdaptiveTournamentSize(creatures.length);

  // Track average rank of selected creatures
  let smallTournamentRankSum = 0;
  let largeTournamentRankSum = 0;
  const iterations = 1000;

  for (let i = 0; i < iterations; i++) {
    const smallSelected = ranking.selectTournament(smallTournamentSize, 0.5);
    const largeSelected = ranking.selectTournament(largeTournamentSize, 0.5);

    // Find rank (index) in sorted population (lower is better)
    const smallRank = ranking.sortedPopulation.findIndex((c) =>
      c.uuid === smallSelected.uuid
    );
    const largeRank = ranking.sortedPopulation.findIndex((c) =>
      c.uuid === largeSelected.uuid
    );

    smallTournamentRankSum += smallRank;
    largeTournamentRankSum += largeRank;
  }

  const avgSmallRank = smallTournamentRankSum / iterations;
  const avgLargeRank = largeTournamentRankSum / iterations;

  // Larger tournaments should produce lower average ranks (better creatures)
  assert(
    avgLargeRank < avgSmallRank,
    `Larger tournaments (avg rank ${avgLargeRank}) should select better creatures than smaller (avg rank ${avgSmallRank})`,
  );
});

Deno.test("AdaptiveTournament - coverage percentage", () => {
  // For a population of 1000:
  // - Fixed size 5 = 0.5% coverage
  // - Adaptive size should be ~3% (sqrt(1000)/1000 ≈ 3.16%)
  const population1000 = 1000;
  const adaptiveSize1000 = calculateAdaptiveTournamentSize(population1000);
  const coveragePct = (adaptiveSize1000 / population1000) * 100;

  assert(
    coveragePct >= 2 && coveragePct <= 10,
    `Coverage for 1000 should be 2-10%, got ${coveragePct.toFixed(2)}%`,
  );
});
