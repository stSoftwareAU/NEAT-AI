import { assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { FindTunePopulation } from "@blackbox/FineTunePopulation.ts";
import { Genus } from "@neat/Genus.ts";
import { Neat } from "@neat/Neat.ts";

/**
 * Regression tests for issue #3506.
 *
 * `FindTunePopulation.make` guarded its score comparisons with a truthiness
 * test (`creature.score && fittest.score`). `0` is falsy but is a legitimate
 * score — with `costOfGrowth: 0` the score is `1 - error`, so an error of
 * exactly `1` yields exactly `0`. Any population member scored `0` aborted the
 * whole run with `ValidationError: Creature <uuid> has invalid score`.
 *
 * Same falsy-zero class as #2295, which fixed `FineTune.ts` only.
 */

/** Scores a creature the way the fitness pass does: field plus `score` tag. */
function score(creature: Creature, value: number): Creature {
  creature.score = value;
  addTag(creature, "score", value.toString());
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeCreature(weight: number): Creature {
  return Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.1,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.8 },
    ],
  }, true);
}

/** Builds a Neat whose population is `[fittest, ...others]` plus a genus. */
function scenario(
  fittestScore: number,
  otherScores: number[],
): { ftp: FindTunePopulation; fittest: Creature; genus: Genus } {
  const neat = new Neat(2, 1, { populationSize: 10 }, []);

  const fittest = score(makeCreature(0.9), fittestScore);

  const others = otherScores.map((value, indx) =>
    score(makeCreature(0.1 + indx * 0.05), value)
  );

  neat.population = [fittest, ...others];

  const genus = new Genus();
  for (const creature of neat.population) {
    genus.addCreature(creature);
  }

  return { ftp: new FindTunePopulation(neat), fittest, genus };
}

Deno.test("FineTunePopulation - a population member scored exactly 0 is valid (regression #3506)", () => {
  const { ftp, fittest, genus } = scenario(0.75, [0]);

  // Must not throw "Creature <uuid> has invalid score".
  const fineTuned = ftp.make(fittest, undefined, genus);

  assertEquals(Array.isArray(fineTuned), true);
});

Deno.test("FineTunePopulation - a population member scored -0 is valid (regression #3506)", () => {
  const { ftp, fittest, genus } = scenario(0.75, [-0]);

  const fineTuned = ftp.make(fittest, undefined, genus);

  assertEquals(Array.isArray(fineTuned), true);
});

Deno.test("FineTunePopulation - a previous fittest scored exactly 0 is valid (regression #3506)", () => {
  const { ftp, fittest, genus } = scenario(0.75, [0.25]);

  const previousFittest = score(makeCreature(0.42), 0);

  const fineTuned = ftp.make(fittest, previousFittest, genus);

  assertEquals(Array.isArray(fineTuned), true);
});

Deno.test("FineTunePopulation - a -Infinity score stays acceptable (issue #2214)", () => {
  // Creatures that suffered a WASM panic are scored -Infinity and deliberately
  // retained in the population; they must not start throwing.
  const { ftp, fittest, genus } = scenario(0.75, [-Infinity]);

  const fineTuned = ftp.make(fittest, undefined, genus);

  assertEquals(Array.isArray(fineTuned), true);
});

Deno.test("FineTunePopulation - a missing or NaN score still throws", () => {
  for (const bad of [undefined, NaN]) {
    const { ftp, fittest, genus } = scenario(0.75, [0.25]);

    const broken = makeCreature(0.33);
    broken.score = bad as number;
    CreatureUtil.makeUUID(broken);
    genus.addCreature(broken);

    // deno-lint-ignore no-explicit-any
    (ftp as any).neat.population.push(broken);

    let threw = false;
    try {
      ftp.make(fittest, undefined, genus);
    } catch (error) {
      threw = true;
      assertEquals(
        (error as Error).message.includes("has invalid score"),
        true,
        `Unexpected error for score ${bad}: ${(error as Error).message}`,
      );
    }
    assertEquals(threw, true, `Expected a throw for score ${bad}`);
  }
});
