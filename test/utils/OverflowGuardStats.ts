/**
 * Unit tests for Issue #2421: proactive weight/bias overflow guard telemetry.
 *
 * Verifies that {@link clampAndTrack}:
 *   - Passes through in-range values untouched and without counting.
 *   - Clamps overflowing values to `±MAX_SAFE_WEIGHT_BIAS` and increments the
 *     per-source counter.
 *   - Preserves non-finite values (NaN, ±Infinity are caller-validated upstream).
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import {
  clampAndTrack,
  getOverflowGuardStats,
  resetOverflowGuardStats,
} from "@utils/OverflowGuardStats.ts";
import { MAX_SAFE_WEIGHT_BIAS } from "@utils/WeightBiasClamp.ts";

Deno.test("clampAndTrack: in-range value passes through, counter unchanged", () => {
  resetOverflowGuardStats();
  const before = getOverflowGuardStats();
  const out = clampAndTrack(1.5, "mutation.weight");
  assertEquals(out, 1.5);
  const after = getOverflowGuardStats();
  assertEquals(after.total, before.total);
  assertEquals(after.counts["mutation.weight"], 0);
});

Deno.test("clampAndTrack: positive overflow is clamped and counted", () => {
  resetOverflowGuardStats();
  const out = clampAndTrack(1.1559466326634707e+195, "training.weight");
  assertEquals(out, MAX_SAFE_WEIGHT_BIAS);
  const stats = getOverflowGuardStats();
  assertEquals(stats.counts["training.weight"], 1);
  assertEquals(stats.total, 1);
});

Deno.test("clampAndTrack: negative overflow is clamped with sign preserved", () => {
  resetOverflowGuardStats();
  const out = clampAndTrack(-2.6680832284972457e+28, "predictiveCoding.bias");
  assertEquals(out, -MAX_SAFE_WEIGHT_BIAS);
  assertEquals(getOverflowGuardStats().counts["predictiveCoding.bias"], 1);
});

Deno.test("clampAndTrack: counters are isolated per source", () => {
  resetOverflowGuardStats();
  clampAndTrack(1e200, "mutation.weight");
  clampAndTrack(1e200, "mutation.weight");
  clampAndTrack(1e200, "training.bias");
  const stats = getOverflowGuardStats();
  assertEquals(stats.counts["mutation.weight"], 2);
  assertEquals(stats.counts["training.bias"], 1);
  assertEquals(stats.counts["rustFfi.weight"], 0);
  assertEquals(stats.total, 3);
});

Deno.test("clampAndTrack: resetOverflowGuardStats clears counters", () => {
  resetOverflowGuardStats();
  clampAndTrack(1e200, "rustFfi.weight");
  assert(getOverflowGuardStats().total >= 1);
  resetOverflowGuardStats();
  assertEquals(getOverflowGuardStats().total, 0);
});

Deno.test("clampAndTrack: returned stats snapshot is defensive copy", () => {
  resetOverflowGuardStats();
  const snapshot = getOverflowGuardStats();
  // The snapshot is a frozen-like read-only view — mutating it must NOT affect
  // subsequent reads.
  const mutable = snapshot.counts as Record<string, number>;
  try {
    mutable["mutation.weight"] = 99;
  } catch {
    // Ignore if reassign is blocked by runtime; we only care that the next read
    // still reports 0.
  }
  clampAndTrack(1.5, "mutation.weight"); // in-range no-op
  assertEquals(getOverflowGuardStats().counts["mutation.weight"], 0);
});
