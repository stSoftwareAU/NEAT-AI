/**
 * The same-seed pre-selection A/B harness (Issue #3932).
 *
 * The harness is what the diversity acceptance criterion is answered with, so
 * its arithmetic is tested rather than trusted: the corpus is deterministic,
 * the score is a real activation over it, the diversity numbers come from the
 * production functions, and an over-generated arm really does consider more
 * candidates than the control.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  type ABSettings,
  buildCorpus,
  CONTROL_ARM,
  DEFAULT_AB_SETTINGS,
  meanGeneticDistance,
  runArm,
  scoreCreature,
} from "../../scripts/lib/preSelectionAB.ts";
import { Creature } from "@creature";
import { withRngTestLock } from "../_rngTestLock.ts";

/** A run small enough for a unit test and large enough to screen something. */
const SMALL: ABSettings = {
  ...DEFAULT_AB_SETTINGS,
  corpusRecords: 120,
  populationSize: 10,
  generations: 4,
  elitism: 2,
};

Deno.test("pre-selection A/B — the corpus is deterministic given the seed", () => {
  const first = buildCorpus(SMALL);
  const second = buildCorpus(SMALL);
  assertEquals(first.length, SMALL.corpusRecords);
  for (let i = 0; i < first.length; i++) {
    assertEquals(first[i].target, second[i].target);
    assertEquals(Array.from(first[i].input), Array.from(second[i].input));
  }
  const other = buildCorpus({ ...SMALL, seed: SMALL.seed + 1 });
  assert(
    other.some((record, i) => record.target !== first[i].target),
    "a different seed must produce a different corpus",
  );
});

Deno.test("pre-selection A/B — scoring is a real activation and a stride costs less", () => {
  const corpus = buildCorpus(SMALL);
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exact = scoreCreature(creature, corpus);
  assertEquals(exact.records, corpus.length);
  assert(exact.score <= 0, "the score is -MSE, so it is never positive");

  const cheap = scoreCreature(creature, corpus, 4);
  assertEquals(cheap.records, Math.ceil(corpus.length / 4));
  assert(cheap.records < exact.records, "a stride scores fewer records");
});

Deno.test("pre-selection A/B — mean genetic distance is bounded and self-zero", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertAlmostEquals(meanGeneticDistance([creature, creature]), 0, 1e-9);
  assertEquals(meanGeneticDistance([creature]), 0);

  const other = new Creature(2, 1, { layers: [{ count: 3 }, { count: 2 }] });
  const distance = meanGeneticDistance([creature, other]);
  assert(distance >= 0 && distance <= 1, `distance ${distance} out of range`);
});

Deno.test("pre-selection A/B — the control arm screens nothing", async () => {
  await withRngTestLock(async () => {
    const corpus = buildCorpus(SMALL);
    const result = await runArm(CONTROL_ARM, SMALL, corpus);
    assertEquals(result.ratio, 1);
    assertEquals(result.screen, "none");
    assertEquals(result.generations.length, SMALL.generations);
    assertEquals(result.eliteScreenRanks.length, 0);
    for (const generation of result.generations) {
      assertEquals(generation.screenedOut, 0);
      assert(generation.speciesCount >= 1);
      assert(generation.recordsScored > 0);
    }
  });
});

Deno.test("pre-selection A/B — an over-generated arm considers more candidates and discards some", async () => {
  await withRngTestLock(async () => {
    const corpus = buildCorpus(SMALL);
    const control = await runArm(CONTROL_ARM, SMALL, corpus);
    const screened = await runArm(
      { arm: "surrogate", ratio: 3, screen: "surrogate" },
      SMALL,
      corpus,
    );
    assert(
      screened.candidatesConsidered > control.candidatesConsidered,
      `the screened arm must consider more candidates, got ` +
        `${screened.candidatesConsidered} vs ${control.candidatesConsidered}`,
    );
    const discarded = screened.generations.reduce(
      (sum, generation) => sum + generation.screenedOut,
      0,
    );
    assert(discarded > 0, "an over-generated arm must discard some offspring");
    // Every generation reports the diversity numbers the criterion asks for.
    for (const generation of screened.generations) {
      assert(generation.meanGeneticDistance >= 0);
      assert(generation.meanGeneticDistance <= 1);
      assert(generation.speciesDiversity > 0);
    }
  });
});
