/**
 * Issue #2828: Seed warm-up structural lock gating.
 *
 * The lock blocks every structural-reduction path (mutations, inline
 * Discovery, Discovery replay, pruning-template DNA sharing) until the
 * warm-up window has elapsed.
 */
import { assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import {
  CURRENT_GENERATION_TAG,
  isSeedWarmupStructuralLockActive,
  isSeedWarmupStructuralLockActiveForCreature,
  WARMUP_GENERATIONS_TAG,
} from "@architecture/CreatureFactory.ts";

Deno.test("structural lock: inactive when no warm-up configured", () => {
  assertEquals(isSeedWarmupStructuralLockActive(0, 0), false);
  assertEquals(isSeedWarmupStructuralLockActive(0, 5), false);
});

Deno.test("structural lock: active during the warm-up window", () => {
  assertEquals(isSeedWarmupStructuralLockActive(1440, 1), true);
  assertEquals(isSeedWarmupStructuralLockActive(1440, 720), true);
  // Boundary: the final warm-up generation is still locked.
  assertEquals(isSeedWarmupStructuralLockActive(1440, 1440), true);
});

Deno.test("structural lock: released once warm-up has elapsed", () => {
  assertEquals(isSeedWarmupStructuralLockActive(1440, 1441), false);
  assertEquals(isSeedWarmupStructuralLockActive(5, 6), false);
});

Deno.test("structural lock: conservative when generation unknown", () => {
  // Warm-up configured but the current generation has not been written
  // yet (fresh factory seed): stay locked so nothing prunes early.
  assertEquals(isSeedWarmupStructuralLockActive(1440, 0), true);
  assertEquals(isSeedWarmupStructuralLockActive(1440, -1), true);
});

Deno.test("structural lock: ignores non-finite inputs", () => {
  assertEquals(isSeedWarmupStructuralLockActive(NaN, 5), false);
  assertEquals(isSeedWarmupStructuralLockActive(10, NaN), true);
});

Deno.test("structural lock (creature): no warm-up tag → inactive", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  assertEquals(isSeedWarmupStructuralLockActiveForCreature(creature), false);
});

Deno.test("structural lock (creature): warm-up tag, mid-window → active", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  addTag(creature, WARMUP_GENERATIONS_TAG, "1440");
  addTag(creature, CURRENT_GENERATION_TAG, "100");
  assertEquals(isSeedWarmupStructuralLockActiveForCreature(creature), true);
});

Deno.test("structural lock (creature): warm-up tag, window elapsed → inactive", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  addTag(creature, WARMUP_GENERATIONS_TAG, "10");
  addTag(creature, CURRENT_GENERATION_TAG, "11");
  assertEquals(isSeedWarmupStructuralLockActiveForCreature(creature), false);
});

Deno.test("structural lock (creature): warm-up tag, no generation tag → active", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  addTag(creature, WARMUP_GENERATIONS_TAG, "1440");
  // No currentGeneration tag — conservative lock keeps structural pruning off.
  assertEquals(isSeedWarmupStructuralLockActiveForCreature(creature), true);
});
