/**
 * Issue #3508: tests for {@link assemblePopulationWithinBudget}.
 *
 * The next generation must never exceed the effective population size, even
 * when several heavy-pool training / discovery / replay results land in the
 * same generation.
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { Creature } from "@creature";
import {
  assemblePopulationWithinBudget,
  type PopulationSlices,
} from "@neat/PopulationBudget.ts";

/** Minimal creature stub: the assembler only moves references around. */
function creature(uuid: string): Creature {
  return { uuid } as unknown as Creature;
}

/** `count` stubs named `${prefix}0`, `${prefix}1`, … */
function creatures(prefix: string, count: number): Creature[] {
  return Array.from({ length: count }, (_, i) => creature(`${prefix}${i}`));
}

function slices(counts: Partial<Record<keyof PopulationSlices, number>>) {
  return {
    elitists: creatures("e", counts.elitists ?? 0),
    trained: creatures("t", counts.trained ?? 0),
    fineTuned: creatures("f", counts.fineTuned ?? 0),
    bred: creatures("b", counts.bred ?? 0),
    dna: creatures("d", counts.dna ?? 0),
  };
}

function uuids(population: Creature[]): string[] {
  return population.map((c) => c.uuid as string);
}

Deno.test("assemblePopulationWithinBudget - within budget keeps every creature in population order", () => {
  const input = slices({
    elitists: 2,
    trained: 1,
    fineTuned: 1,
    bred: 3,
    dna: 1,
  });
  const result = assemblePopulationWithinBudget(input, 10);

  assertEquals(uuids(result.population), [
    "e0",
    "e1",
    "t0",
    "f0",
    "b0",
    "b1",
    "b2",
    "d0",
  ]);
  assertEquals(result.dropped, []);
});

Deno.test("assemblePopulationWithinBudget - exactly at budget drops nothing", () => {
  const input = slices({ elitists: 2, trained: 2, bred: 6 });
  const result = assemblePopulationWithinBudget(input, 10);

  assertEquals(result.population.length, 10);
  assertEquals(result.dropped.length, 0);
});

Deno.test("assemblePopulationWithinBudget - overflow trims the bred slice first", () => {
  // 2 elites + 6 trained (heavy-pool burst) + 6 bred = 14, budget 10.
  const input = slices({ elitists: 2, trained: 6, bred: 6 });
  const result = assemblePopulationWithinBudget(input, 10);

  assertEquals(result.population.length, 10);
  assertEquals(uuids(result.dropped), ["b2", "b3", "b4", "b5"]);
});

Deno.test("assemblePopulationWithinBudget - trims trained once the bred slice is exhausted", () => {
  // The 3x overshoot from the issue: 48 creatures for a budget of 15.
  const input = slices({ elitists: 2, trained: 40, fineTuned: 3, bred: 3 });
  const result = assemblePopulationWithinBudget(input, 15);

  assertEquals(result.population.length, 15);
  assertEquals(result.dropped.length, 33);
  // Elites, the fine-tuned slice and the surviving trained head are kept.
  assertEquals(uuids(result.population).slice(0, 3), ["e0", "e1", "t0"]);
  assertEquals(uuids(result.population).slice(-3), ["f0", "f1", "f2"]);
});

Deno.test("assemblePopulationWithinBudget - a trained burst is absorbed before fine-tuned or DNA", () => {
  const input = slices({ elitists: 1, trained: 8, fineTuned: 2, dna: 2 });
  const result = assemblePopulationWithinBudget(input, 5);

  // The whole overflow fits inside the trained slice, so the fine-tuned and
  // DNA creatures — sized against the budget already — all survive.
  assertEquals(uuids(result.population), ["e0", "f0", "f1", "d0", "d1"]);
  assertEquals(result.dropped.length, 8);
});

Deno.test("assemblePopulationWithinBudget - trims fine-tuned before DNA once bred and trained are exhausted", () => {
  const input = slices({ elitists: 1, fineTuned: 4, dna: 4 });
  const result = assemblePopulationWithinBudget(input, 5);

  assertEquals(uuids(result.population), ["e0", "d0", "d1", "d2", "d3"]);
  assertEquals(uuids(result.dropped), ["f0", "f1", "f2", "f3"]);
});

Deno.test("assemblePopulationWithinBudget - elites are never dropped, even above budget", () => {
  const input = slices({ elitists: 6, trained: 4, bred: 4 });
  const result = assemblePopulationWithinBudget(input, 3);

  assertEquals(uuids(result.population), ["e0", "e1", "e2", "e3", "e4", "e5"]);
  assertEquals(result.dropped.length, 8);
});

Deno.test("assemblePopulationWithinBudget - every creature is either kept or dropped exactly once", () => {
  const input = slices({
    elitists: 2,
    trained: 5,
    fineTuned: 4,
    bred: 7,
    dna: 3,
  });
  const result = assemblePopulationWithinBudget(input, 9);

  const seen = new Set([
    ...uuids(result.population),
    ...uuids(result.dropped),
  ]);
  assertEquals(seen.size, 21);
  assertEquals(result.population.length + result.dropped.length, 21);
});

Deno.test("assemblePopulationWithinBudget - empty slices produce an empty population", () => {
  const result = assemblePopulationWithinBudget(slices({}), 10);

  assertEquals(result.population, []);
  assertEquals(result.dropped, []);
});

Deno.test("assemblePopulationWithinBudget - zero or negative budget keeps only the elites", () => {
  const input = slices({ elitists: 2, trained: 3, bred: 3 });

  assertEquals(
    uuids(assemblePopulationWithinBudget(input, 0).population),
    ["e0", "e1"],
  );
  assertEquals(
    uuids(assemblePopulationWithinBudget(input, -5).population),
    ["e0", "e1"],
  );
});

Deno.test("assemblePopulationWithinBudget - fractional budget floors rather than over-filling", () => {
  const input = slices({ elitists: 1, trained: 2, bred: 4 });
  const result = assemblePopulationWithinBudget(input, 5.9);

  assertEquals(result.population.length, 5);
});

Deno.test("assemblePopulationWithinBudget - non-finite budget fails loudly", () => {
  const input = slices({ elitists: 1, bred: 2 });

  assertThrows(
    () => assemblePopulationWithinBudget(input, Number.NaN),
    Error,
    "finite",
  );
  assertThrows(
    () => assemblePopulationWithinBudget(input, Number.POSITIVE_INFINITY),
    Error,
    "finite",
  );
});
