/**
 * Behavioural tests for configurable selection pressure (Issue #2929).
 *
 * Verifies that:
 * - `calculateAdaptiveTournamentSize` honours custom bounds while its
 *   defaults reproduce the prior formula.
 * - Increasing the POWER exponent measurably increases the probability that
 *   the top-ranked creature is selected.
 * - Increasing the (fixed) tournament size measurably increases the
 *   probability that the top-ranked creature is selected.
 *
 * These are statistical "what" tests: they run enough iterations through the
 * real selection code that the directional effect is robust without relying on
 * a seeded global RNG (tests run in parallel and share the global RNG).
 */
import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil, Selection } from "../../mod.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { selectParent } from "@breed/ParentSelection.ts";
import { calculateAdaptiveTournamentSize } from "@breed/AdaptiveTournamentSize.ts";

/** Build a population with strictly descending scores (best first). */
function createPopulationOfSize(size: number): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const ni: CreatureInternal = {
      input: 1,
      output: 1,
      score: size - i, // descending scores → creature 0 is best
      neurons: [{
        index: 1,
        type: "output",
        squash: "IDENTITY",
        bias: i * 0.001, // distinct biases → unique UUIDs
      }],
      synapses: [{ from: 0, to: 1, weight: 1 + i * 0.001 }],
    };
    const creature = Creature.fromJSON(ni);
    CreatureUtil.makeUUID(creature);
    creature.score = ni.score;
    addTag(creature, "score", ni.score!.toString());
    creatures.push(creature);
  }
  return creatures;
}

/** Count how often `selectParent` returns the top-ranked creature. */
function countTopSelections(
  ranking: FitnessRanking,
  config: ReturnType<typeof createNeatConfig>,
  iterations: number,
): number {
  const topUuid = ranking.sortedPopulation[0].uuid;
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    if (selectParent(ranking, config).uuid === topUuid) count++;
  }
  return count;
}

// ── Adaptive bounds ─────────────────────────────────────────────────

Deno.test("SelectionPressure - adaptive bounds default to prior formula", () => {
  // Omitting bounds reproduces max(3, min(floor(sqrt(pop)), floor(pop*0.1))).
  for (const pop of [10, 50, 100, 400, 1000]) {
    const sqrtSize = Math.floor(Math.sqrt(pop));
    const pctSize = Math.floor(pop * 0.1);
    const expected = Math.max(3, Math.min(sqrtSize, pctSize));
    assertEquals(calculateAdaptiveTournamentSize(pop), expected);
  }
});

Deno.test("SelectionPressure - custom adaptive bounds change the size", () => {
  // Population 100: default sqrt scaling → 10. A higher exponent and cap
  // fraction raise the size; a higher minimum raises the floor.
  assertEquals(calculateAdaptiveTournamentSize(100), 10);

  // capFraction 0.5 lifts the 10% cap so the sqrt term (10) wins.
  assertEquals(
    calculateAdaptiveTournamentSize(100, { capFraction: 0.5 }),
    10,
  );

  // exponent 1.0 → floor(100^1)=100, capped at floor(100*0.5)=50.
  assertEquals(
    calculateAdaptiveTournamentSize(100, {
      sqrtExponent: 1,
      capFraction: 0.5,
    }),
    50,
  );

  // A high minimum dominates for a small population.
  assertEquals(
    calculateAdaptiveTournamentSize(10, { minSize: 8 }),
    8,
  );
});

// ── POWER exponent ──────────────────────────────────────────────────

Deno.test("SelectionPressure - higher POWER exponent selects the top creature more often", () => {
  const creatures = createPopulationOfSize(50);
  const ranking = new FitnessRanking(creatures);
  const iterations = 4000;

  const lowConfig = createNeatConfig({
    selection: Selection.POWER,
    selectionPressure: { power: 1 },
  });
  const highConfig = createNeatConfig({
    selection: Selection.POWER,
    selectionPressure: { power: 12 },
  });

  const lowTop = countTopSelections(ranking, lowConfig, iterations);
  const highTop = countTopSelections(ranking, highConfig, iterations);

  assert(
    highTop > lowTop,
    `Higher POWER exponent should pick the top creature more often: ` +
      `power=12 picked top ${highTop} times vs power=1 ${lowTop} times`,
  );
});

// ── Tournament size ─────────────────────────────────────────────────

Deno.test("SelectionPressure - larger tournament size selects the top creature more often", () => {
  const creatures = createPopulationOfSize(50);
  const ranking = new FitnessRanking(creatures);
  const iterations = 4000;

  const smallConfig = createNeatConfig({
    selection: Selection.TOURNAMENT,
    selectionPressure: {
      adaptiveTournament: false,
      tournamentSize: 2,
      tournamentProbability: 1, // deterministic: best participant always wins
    },
  });
  const largeConfig = createNeatConfig({
    selection: Selection.TOURNAMENT,
    selectionPressure: {
      adaptiveTournament: false,
      tournamentSize: 25,
      tournamentProbability: 1,
    },
  });

  const smallTop = countTopSelections(ranking, smallConfig, iterations);
  const largeTop = countTopSelections(ranking, largeConfig, iterations);

  assert(
    largeTop > smallTop,
    `Larger tournament should pick the top creature more often: ` +
      `size=25 picked top ${largeTop} times vs size=2 ${smallTop} times`,
  );
});

Deno.test("SelectionPressure - default config reproduces adaptive tournament selection", () => {
  // With defaults, TOURNAMENT selection still uses the adaptive size path and
  // returns valid members of the population.
  const creatures = createPopulationOfSize(100);
  const ranking = new FitnessRanking(creatures);
  const config = createNeatConfig({ selection: Selection.TOURNAMENT });

  for (let i = 0; i < 50; i++) {
    const selected = selectParent(ranking, config);
    assert(creatures.some((c) => c.uuid === selected.uuid));
  }
});
