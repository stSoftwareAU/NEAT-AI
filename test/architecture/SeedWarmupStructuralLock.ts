/**
 * Issue #2828: Seed warm-up structural lock gating.
 *
 * The lock blocks every structural-reduction path (mutations, inline
 * Discovery, Discovery replay, pruning-template DNA sharing) until the
 * warm-up window has elapsed.
 */
import { assertEquals } from "@std/assert";
import { isSeedWarmupStructuralLockActive } from "@architecture/CreatureFactory.ts";

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

// Issue #2910: the per-creature variant
// `isSeedWarmupStructuralLockActiveForCreature` has been removed — its only
// production caller (DiscoveryReplayQueue) now reads the lock from Neat-level
// warm-up context. The remaining tests above cover the numbers variant that
// every gate uses.
