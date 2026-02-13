/**
 * Unit tests for ElitismUtils.
 *
 * Issue #1407: Targeted unit tests for architecture core - elitism selection,
 * population sorting by score, and verbose logging utilities.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import {
  logVerbose,
  makeElitists,
  sortCreaturesByScore,
} from "../../src/architecture/ElitismUtils.ts";

/**
 * Helper to create a scored creature.
 */
function makeScoredCreature(score: number): Creature {
  const creature = new Creature(2, 1);
  creature.score = score;
  addTag(creature, "error", (1 - score).toString());
  return creature;
}

// --- sortCreaturesByScore tests ---

Deno.test("sortCreaturesByScore - sorts descending by score", () => {
  const creatures = [
    makeScoredCreature(0.3),
    makeScoredCreature(0.9),
    makeScoredCreature(0.1),
    makeScoredCreature(0.7),
  ];

  sortCreaturesByScore(creatures);

  assertEquals(creatures[0].score, 0.9);
  assertEquals(creatures[1].score, 0.7);
  assertEquals(creatures[2].score, 0.3);
  assertEquals(creatures[3].score, 0.1);
});

Deno.test("sortCreaturesByScore - single creature returns same array", () => {
  const creatures = [makeScoredCreature(0.5)];
  const result = sortCreaturesByScore(creatures);

  assertEquals(result.length, 1);
  assertEquals(result[0].score, 0.5);
});

Deno.test("sortCreaturesByScore - equal scores maintains stable order", () => {
  const c1 = makeScoredCreature(0.5);
  const c2 = makeScoredCreature(0.5);
  const creatures = [c1, c2];

  sortCreaturesByScore(creatures);

  // Both should still be present
  assertEquals(creatures.length, 2);
  assertEquals(creatures[0].score, 0.5);
  assertEquals(creatures[1].score, 0.5);
});

Deno.test("sortCreaturesByScore - handles negative scores", () => {
  const creatures = [
    makeScoredCreature(-0.5),
    makeScoredCreature(0.5),
    makeScoredCreature(-0.1),
  ];

  sortCreaturesByScore(creatures);

  assertEquals(creatures[0].score, 0.5);
  assertEquals(creatures[1].score, -0.1);
  assertEquals(creatures[2].score, -0.5);
});

Deno.test("sortCreaturesByScore - returns the same array reference", () => {
  const creatures = [makeScoredCreature(0.5)];
  const result = sortCreaturesByScore(creatures);
  assert(result === creatures, "Should sort in-place and return same array");
});

// --- makeElitists tests ---

Deno.test("makeElitists - returns top creatures from sorted population", () => {
  const creatures = [
    makeScoredCreature(0.9),
    makeScoredCreature(0.7),
    makeScoredCreature(0.5),
    makeScoredCreature(0.3),
  ];

  const result = makeElitists(creatures, 2);

  assertEquals(result.elitists.length, 2);
  assertEquals(result.elitists[0].score, 0.9);
  assertEquals(result.elitists[1].score, 0.7);
});

Deno.test("makeElitists - defaults to size 1", () => {
  const creatures = [
    makeScoredCreature(0.9),
    makeScoredCreature(0.5),
  ];

  const result = makeElitists(creatures);

  assertEquals(result.elitists.length, 1);
  assertEquals(result.elitists[0].score, 0.9);
});

Deno.test("makeElitists - clamps size to population length", () => {
  const creatures = [
    makeScoredCreature(0.9),
    makeScoredCreature(0.5),
  ];

  const result = makeElitists(creatures, 10);

  assertEquals(result.elitists.length, 2);
});

Deno.test("makeElitists - throws for empty population", () => {
  assertThrows(
    () => makeElitists([]),
    Error,
    "Population must have creatures",
  );
});

Deno.test("makeElitists - throws for size 0", () => {
  const creatures = [makeScoredCreature(0.5)];
  assertThrows(
    () => makeElitists(creatures, 0),
    Error,
  );
});

Deno.test("makeElitists - throws for non-integer size", () => {
  const creatures = [makeScoredCreature(0.5)];
  assertThrows(
    () => makeElitists(creatures, 1.5),
    Error,
  );
});

Deno.test("makeElitists - averageScore is NaN when not verbose", () => {
  const creatures = [makeScoredCreature(0.5)];
  const result = makeElitists(creatures, 1, false);

  assert(
    Number.isNaN(result.averageScore),
    "averageScore should be NaN when not verbose",
  );
});

Deno.test("makeElitists - averageScore is computed when verbose", () => {
  const creatures = [
    makeScoredCreature(0.8),
    makeScoredCreature(0.6),
  ];

  const result = makeElitists(creatures, 1, true);

  assertEquals(result.averageScore, 0.7);
});

// --- logVerbose tests ---

Deno.test("logVerbose - calculates average score", () => {
  const creatures = [
    makeScoredCreature(0.8),
    makeScoredCreature(0.6),
    makeScoredCreature(0.4),
  ];

  const avg = logVerbose(creatures);

  const expected = (0.8 + 0.6 + 0.4) / 3;
  assert(
    Math.abs(avg - expected) < 1e-10,
    `Average ${avg} should be close to ${expected}`,
  );
});

Deno.test("logVerbose - marks trained creatures as notified", () => {
  const creature = makeScoredCreature(0.8);
  addTag(creature, "trainID", "test-train-001");
  addTag(creature, "untrained-error", "0.5");

  logVerbose([creature]);

  assertEquals(getTag(creature, "notified"), "Yes");
});

Deno.test("logVerbose - skips already-notified creatures", () => {
  const creature = makeScoredCreature(0.8);
  addTag(creature, "trainID", "test-train-001");
  addTag(creature, "untrained-error", "0.5");
  addTag(creature, "notified", "Yes");

  // Should not throw or re-process
  const avg = logVerbose([creature]);
  assertEquals(avg, 0.8);
});

Deno.test("logVerbose - handles creatures without trainID", () => {
  const creature = makeScoredCreature(0.5);

  // Should not throw for creatures without trainID
  const avg = logVerbose([creature]);
  assertEquals(avg, 0.5);
});

Deno.test("logVerbose - sets trainMsg tag for trained creatures", () => {
  const creature = makeScoredCreature(0.8);
  addTag(creature, "trainID", "test-train-002");
  addTag(creature, "untrained-error", "0.9");
  addTag(creature, "approach", "compact");

  logVerbose([creature]);

  const trainMsg = getTag(creature, "trainMsg");
  assert(trainMsg !== undefined, "trainMsg tag should be set");
  assert(
    typeof trainMsg === "string" && trainMsg.length > 0,
    "trainMsg should be a non-empty string",
  );
});
