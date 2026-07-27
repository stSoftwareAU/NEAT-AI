/**
 * Tests for random-immigrant injection on a detected plateau (Issue #2933).
 *
 * Verifies:
 *  - The {@link RandomImmigrants} controller only signals an injection when
 *    enabled, on a plateau for at least `triggerWindow` generations, and
 *    outside the cooldown window.
 *  - {@link injectRandomImmigrants} preserves the leading elites, replaces
 *    the weakest non-elite creatures (unscored offspring first), and keeps
 *    the population length unchanged.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  injectRandomImmigrants,
  RandomImmigrants,
} from "@neat/RandomImmigrants.ts";
import { DEFAULT_RANDOM_IMMIGRANTS_CONFIG } from "@config/RandomImmigrantsConfig.ts";

function controller(
  overrides: Partial<typeof DEFAULT_RANDOM_IMMIGRANTS_CONFIG> = {},
): RandomImmigrants {
  return new RandomImmigrants({
    ...DEFAULT_RANDOM_IMMIGRANTS_CONFIG,
    ...overrides,
  });
}

/** Build a tiny creature tagged with a score and uuid for ranking tests. */
function scored(score: number | undefined, uuid: string): Creature {
  const c = new Creature(2, 1);
  c.score = score;
  c.uuid = uuid;
  return c;
}

Deno.test("RandomImmigrants - disabled never injects", () => {
  const c = controller({ enabled: false, triggerWindow: 1 });
  assertEquals(c.shouldInject(100, 100), false);
  assertEquals(c.immigrantCount(50, 1), 0);
});

Deno.test("RandomImmigrants - waits for triggerWindow generations on plateau", () => {
  const c = controller({ enabled: true, triggerWindow: 5, cooldown: 0 });
  assertEquals(c.shouldInject(4, 10), false);
  assertEquals(c.shouldInject(5, 10), true);
  assertEquals(c.shouldInject(6, 11), true);
});

Deno.test("RandomImmigrants - cooldown blocks repeat injections", () => {
  const c = controller({ enabled: true, triggerWindow: 3, cooldown: 10 });
  assertEquals(c.shouldInject(3, 20), true);
  c.recordInjection(20);
  // Still on plateau, but within the cooldown window.
  assertEquals(c.shouldInject(4, 25), false);
  assertEquals(c.shouldInject(5, 29), false);
  // Cooldown elapsed (30 - 20 === 10).
  assertEquals(c.shouldInject(6, 30), true);
});

Deno.test("RandomImmigrants - reset clears the cooldown", () => {
  const c = controller({ enabled: true, triggerWindow: 1, cooldown: 10 });
  c.recordInjection(5);
  assertEquals(c.shouldInject(1, 6), false);
  c.reset();
  assertEquals(c.shouldInject(1, 6), true);
});

Deno.test("RandomImmigrants - immigrantCount is floor(fraction * nonElite), min 1", () => {
  const c = controller({ enabled: true, injectionFraction: 0.1 });
  // 0.1 * (100 - 1) = 9.9 → floor 9
  assertEquals(c.immigrantCount(100, 1), 9);
  // Rounds down to 0 but enabled → at least one immigrant.
  assertEquals(c.immigrantCount(10, 5), 1);
  // No non-elite slots → none.
  assertEquals(c.immigrantCount(3, 3), 0);
  assertEquals(c.immigrantCount(2, 5), 0);
});

Deno.test("injectRandomImmigrants - preserves elites and replaces weakest non-elites", () => {
  // Elites first (highest scores), then non-elites worst → best.
  const elite0 = scored(100, "elite-0");
  const elite1 = scored(90, "elite-1");
  const mid = scored(50, "mid");
  const worst = scored(10, "worst");
  const best = scored(70, "best-non-elite");
  const population = [elite0, elite1, mid, worst, best];

  let made = 0;
  const result = injectRandomImmigrants(
    population,
    2, // eliteCount
    1, // replace the single weakest non-elite
    () => {
      made++;
      return scored(undefined, `immigrant-${made}`);
    },
  );

  assertEquals(result.injected, 1);
  assertEquals(result.replacedUuids, ["worst"]);
  assertEquals(population.length, 5);
  // Elites untouched and still at the front.
  assertEquals(population[0], elite0);
  assertEquals(population[1], elite1);
  // The weakest non-elite is gone; the others survive.
  const uuids = population.map((c) => c.uuid);
  assert(!uuids.includes("worst"), "weakest non-elite should be replaced");
  assert(uuids.includes("mid"), "mid survivor should remain");
  assert(uuids.includes("best-non-elite"), "best survivor should remain");
  assert(uuids.includes("immigrant-1"), "fresh immigrant should be present");
});

Deno.test("injectRandomImmigrants - unscored offspring are replaced before scored survivors", () => {
  const elite = scored(100, "elite");
  const scoredSurvivor = scored(80, "scored");
  const offspringA = scored(undefined, "offspring-a");
  const offspringB = scored(undefined, "offspring-b");
  const population = [elite, scoredSurvivor, offspringA, offspringB];

  const result = injectRandomImmigrants(
    population,
    1,
    2,
    () => scored(undefined, "immigrant"),
  );

  assertEquals(result.injected, 2);
  // Both unscored offspring replaced; the scored survivor kept.
  assertEquals(result.replacedUuids.sort(), ["offspring-a", "offspring-b"]);
  const uuids = population.map((c) => c.uuid);
  assert(uuids.includes("elite"));
  assert(uuids.includes("scored"));
  assert(!uuids.includes("offspring-a"));
  assert(!uuids.includes("offspring-b"));
});

Deno.test("injectRandomImmigrants - count clamped to non-elite count", () => {
  const population = [scored(10, "a"), scored(5, "b"), scored(1, "c")];
  const result = injectRandomImmigrants(
    population,
    1,
    99, // more than available non-elites
    () => scored(undefined, "immigrant"),
  );
  // Only 2 non-elites available.
  assertEquals(result.injected, 2);
  assertEquals(population.length, 3);
  assertEquals(population[0].uuid, "a"); // elite preserved
});

Deno.test("injectRandomImmigrants - replaced victim is not disposed (shared ownership)", () => {
  // Regression (PR #3497): the weakest non-elite is frequently the SAME
  // creature object still held by the breeding genus (elites/survivors are
  // shared between the population and the parent pool). Disposing it here
  // emptied its neurons while leaving `input` non-zero, so a later
  // shallowClone during dedup breeding read `undefined.id` and aborted the
  // whole evolve run. The victim must stay a valid, breedable genome.
  const elite = scored(100, "elite");
  const worst = scored(1, "worst");
  const population = [elite, worst];
  const worstNeuronCount = worst.neurons.length;

  const result = injectRandomImmigrants(
    population,
    1,
    1,
    () => scored(undefined, "immigrant"),
  );

  assertEquals(result.injected, 1);
  assertEquals(result.replacedUuids, ["worst"]);
  // The dropped victim is still intact — a second holder (the genus) can
  // clone it without crashing.
  assertEquals(
    worst.neurons.length,
    worstNeuronCount,
    "replaced victim must retain its neurons (not be disposed)",
  );
  assert(worst.input > 0, "victim still declares its input count");
  // shallowClone must succeed on the dropped victim (the crashing path).
  const clone = worst.shallowClone();
  assertEquals(clone.neurons.length, worstNeuronCount);
});

Deno.test("injectRandomImmigrants - zero count is a no-op", () => {
  const population = [scored(10, "a"), scored(5, "b")];
  const result = injectRandomImmigrants(
    population,
    1,
    0,
    () => scored(undefined, "immigrant"),
  );
  assertEquals(result.injected, 0);
  assertEquals(result.replacedUuids, []);
  assertEquals(population.map((c) => c.uuid), ["a", "b"]);
});
