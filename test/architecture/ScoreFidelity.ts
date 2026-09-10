/**
 * Per-creature score fidelity (Issue #3931).
 *
 * The tag is what tells an exact score from a cheap one, so every way of
 * getting it wrong has to fail rather than resolve to "exact": an out-of-range
 * value, a corrupt tag, and a partial-corpus count that cannot describe a real
 * evaluation. And a run that never approximates anything must stay untagged, or
 * every creature export in the project changes shape.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import {
  assertExactScore,
  EXACT_SCORE_FIDELITY,
  isExactScore,
  markScoreFidelity,
  MAX_APPROXIMATE_FIDELITY,
  partialCorpusFidelity,
  refreshExactScoreFidelity,
  SCORE_FIDELITY_TAG,
  scoreFidelity,
} from "@architecture/ScoreFidelity.ts";
import { EXACT_FIDELITY } from "@archive/EvaluationArchive.ts";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";

/** A scored creature, with a UUID so error messages can name it. */
function scored(score: number, uuid: string): Creature {
  const creature = new Creature(2, 1, { lazyInitialization: true });
  creature.uuid = uuid;
  creature.score = score;
  return creature;
}

Deno.test("score fidelity — exact is the same number the archive records", () => {
  assertEquals(EXACT_SCORE_FIDELITY, EXACT_FIDELITY);
});

Deno.test("score fidelity — the tag name does not collide with the archive's field", () => {
  // Issue #3929 asserts `fidelity` never appears as a creature tag; this is a
  // different concept and must not borrow that name. Pinned, because renaming
  // it back would break that contract silently.
  assertEquals(SCORE_FIDELITY_TAG, "scoreFidelity");
});

Deno.test("score fidelity — an untagged creature reads as never approximated", () => {
  const creature = scored(1, "untouched");
  assertEquals(scoreFidelity(creature), null);
  assertEquals(isExactScore(creature), true);
  assertExactScore(creature, "elitism");
});

Deno.test("score fidelity — a recorded fidelity round-trips", () => {
  const creature = scored(1, "a");
  markScoreFidelity(creature, 0.25);
  assertEquals(scoreFidelity(creature), 0.25);
  assertEquals(isExactScore(creature), false);
});

Deno.test("score fidelity — an approximate score is refused where ground truth is required", () => {
  const creature = scored(1, "a");
  markScoreFidelity(creature, 0.25);
  const error = assertThrows(
    () => assertExactScore(creature, "export"),
    EvolutionControlError,
  );
  assertEquals(error.reason, "APPROXIMATE_SCORE");
  assert(error.message.includes("export"), error.message);
});

Deno.test("score fidelity — an out-of-range fidelity is rejected, never clamped", () => {
  const creature = scored(1, "a");
  for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const error = assertThrows(
      () => markScoreFidelity(creature, bad),
      EvolutionControlError,
    );
    assertEquals(error.reason, "INVALID_FIDELITY");
  }
});

Deno.test("score fidelity — a corrupt tag is refused, not read as exact", () => {
  const creature = scored(1, "a");
  creature.tags = [{ name: SCORE_FIDELITY_TAG, value: "not-a-number" }];
  const error = assertThrows(
    () => scoreFidelity(creature),
    EvolutionControlError,
  );
  assertEquals(error.reason, "INVALID_FIDELITY");
});

Deno.test("score fidelity — an exact score refreshes a stale approximate tag", () => {
  const creature = scored(1, "a");
  markScoreFidelity(creature, 0.2);
  refreshExactScoreFidelity(creature);
  assertEquals(scoreFidelity(creature), EXACT_SCORE_FIDELITY);
  assertEquals(isExactScore(creature), true);
});

Deno.test("score fidelity — a creature that was never approximated stays untagged", () => {
  const creature = scored(1, "b");
  refreshExactScoreFidelity(creature);
  assertEquals(getTag(creature, SCORE_FIDELITY_TAG), null);
});

Deno.test("score fidelity — a partial-corpus score is never rounded up to exact", () => {
  assertEquals(partialCorpusFidelity(500, 1000), 0.5);
  assertEquals(partialCorpusFidelity(1000, 1000), MAX_APPROXIMATE_FIDELITY);
  assert(partialCorpusFidelity(0, 1000) > 0);
  assert(partialCorpusFidelity(0, 1000) < 1);
});

Deno.test("score fidelity — a partial-corpus count that cannot describe an evaluation is refused", () => {
  for (
    const [scoredRecords, corpus] of [[10, 0], [10, -1], [-1, 100], [
      Number.NaN,
      100,
    ], [10, Number.NaN]]
  ) {
    const error = assertThrows(
      () => partialCorpusFidelity(scoredRecords, corpus),
      EvolutionControlError,
    );
    assertEquals(error.reason, "INVALID_FIDELITY");
  }
});

Deno.test("score fidelity — the tag survives the clone the export is built from", () => {
  const creature = new Creature(2, 1);
  creature.uuid = "export-me";
  creature.score = 9;
  markScoreFidelity(creature, 0.25);
  assertEquals(scoreFidelity(creature.shallowClone()), 0.25);
});
