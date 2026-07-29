/**
 * Unit tests for the population cap (Issue #3508).
 *
 * `trimPopulationToSize` is the missing bound on the assembled population:
 * only the bred slice was budgeted, so heavy-pool results landing in one
 * generation grew the population past the configured size.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { trimPopulationToSize } from "@neat/PopulationCap.ts";

/** Builds a distinct creature, optionally with a score. */
function makeCreature(score?: number): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  CreatureUtil.makeUUID(creature);
  if (score !== undefined) {
    creature.score = score;
  }
  return creature;
}

Deno.test("trimPopulationToSize: no-op when the population is within the cap", () => {
  const population = [makeCreature(5), makeCreature(), makeCreature()];
  const expected = [...population];

  const result = trimPopulationToSize(population, 1, 5);

  assertEquals(result.removed, 0);
  assertEquals(result.removedUuids, []);
  assertEquals(population, expected, "population must be untouched");
});

Deno.test("trimPopulationToSize: trims exactly to the cap", () => {
  const population = Array.from({ length: 20 }, () => makeCreature());

  const result = trimPopulationToSize(population, 2, 8);

  assertEquals(population.length, 8);
  assertEquals(result.removed, 12);
  assertEquals(result.removedUuids.length, 12);
});

Deno.test("trimPopulationToSize: elites are never dropped", () => {
  const elites = [makeCreature(9), makeCreature(8)];
  const population = [
    ...elites,
    ...Array.from({ length: 10 }, () => makeCreature()),
  ];

  trimPopulationToSize(population, elites.length, 4);

  assertEquals(population.length, 4);
  assertEquals(population[0], elites[0], "top elite must survive");
  assertEquals(population[1], elites[1], "second elite must survive");
});

Deno.test("trimPopulationToSize: elites exceeding the cap are still kept", () => {
  const elites = [makeCreature(9), makeCreature(8), makeCreature(7)];
  const population = [...elites, makeCreature(), makeCreature()];

  const result = trimPopulationToSize(population, elites.length, 2);

  // Elitism wins over the cap; only the non-elites can be dropped.
  assertEquals(population.length, 3);
  assertEquals(result.removed, 2);
  assertEquals(population, elites);
});

Deno.test("trimPopulationToSize: drops unscored creatures before scored survivors", () => {
  const elite = makeCreature(10);
  const unscored = makeCreature();
  const scoredLow = makeCreature(1);
  const scoredHigh = makeCreature(4);
  const population = [elite, unscored, scoredLow, scoredHigh];

  const result = trimPopulationToSize(population, 1, 3);

  assertEquals(result.removed, 1);
  assertEquals(result.removedUuids, [unscored.uuid]);
  assertEquals(population, [elite, scoredLow, scoredHigh]);
});

Deno.test("trimPopulationToSize: drops the lowest scores first", () => {
  const elite = makeCreature(10);
  const worst = makeCreature(0.1);
  const middle = makeCreature(2);
  const best = makeCreature(5);
  const population = [elite, worst, middle, best];

  trimPopulationToSize(population, 1, 3);

  assertEquals(population, [elite, middle, best]);
});

Deno.test("trimPopulationToSize: keeps surviving creatures in assembly order", () => {
  const elite = makeCreature(10);
  // Six unscored creatures — the tie-break must be assembly order, so the
  // earliest (heavy-pool) entries go first and the later (bred) entries stay.
  const rest = Array.from({ length: 6 }, () => makeCreature());
  const population = [elite, ...rest];

  trimPopulationToSize(population, 1, 4);

  assertEquals(population, [elite, rest[3], rest[4], rest[5]]);
});

Deno.test("trimPopulationToSize: dropped creatures are not disposed", () => {
  const elite = makeCreature(10);
  const victim = makeCreature();
  const population = [elite, victim];

  trimPopulationToSize(population, 1, 1);

  assertEquals(population.length, 1);
  assert(
    victim.neurons.length > 0 && victim.synapses.length > 0,
    "dropped creatures are shared with the genus and must not be disposed",
  );
});

Deno.test("trimPopulationToSize: a cap of zero empties the non-elite slice", () => {
  const population = [makeCreature(1), makeCreature(), makeCreature()];

  const result = trimPopulationToSize(population, 0, 0);

  assertEquals(population.length, 0);
  assertEquals(result.removed, 3);
});

Deno.test("trimPopulationToSize: handles an empty population", () => {
  const population: Creature[] = [];

  const result = trimPopulationToSize(population, 2, 5);

  assertEquals(population.length, 0);
  assertEquals(result.removed, 0);
});

Deno.test("trimPopulationToSize: an elite count beyond the population is clamped", () => {
  const population = [makeCreature(3), makeCreature(2)];

  const result = trimPopulationToSize(population, 99, 1);

  assertEquals(result.removed, 0, "every entry is an elite once clamped");
  assertEquals(population.length, 2);
});

Deno.test("trimPopulationToSize: a non-finite cap drops every non-elite", () => {
  const population = [makeCreature(3), makeCreature(), makeCreature()];

  const result = trimPopulationToSize(population, 1, Number.NaN);

  assertEquals(result.removed, 2, "NaN is not a usable budget — cap at zero");
  assertEquals(population.length, 1);
});
