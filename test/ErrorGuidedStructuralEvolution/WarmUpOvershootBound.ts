/**
 * Pure-decision tests for the warm-up overshoot bound (GRQ #4067).
 */
import { assertEquals } from "@std/assert";
import {
  decideWarmUpOvershoot,
  STALL_WARMUP_MAX_OVERSHOOT_MULTIPLE,
} from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";

Deno.test("warm-up overshoot: continues when under allowance with ample remaining (#4067)", () => {
  const decision = decideWarmUpOvershoot({
    chunkElapsedMs: 8 * 60_000, // 8m vs 2m budget = 4×
    perChunkMaxMs: 2 * 60_000,
    completedChunks: 1,
    totalChunks: 8,
    remainingDeadlineMs: 50 * 60_000,
  });
  assertEquals(decision.continue, true);
  assertEquals(decision.reason, "within_allowance");
  assertEquals(
    decision.allowanceMs,
    2 * 60_000 * STALL_WARMUP_MAX_OVERSHOOT_MULTIPLE,
  );
});

Deno.test("warm-up overshoot: aborts when elapsed exceeds 5× budget (#4067)", () => {
  // GRQ-22 shape: 13m47s on a 2m budget ≈ 6.9× → abort.
  const decision = decideWarmUpOvershoot({
    chunkElapsedMs: 13 * 60_000 + 47_000,
    perChunkMaxMs: 2 * 60_000,
    completedChunks: 1,
    totalChunks: 3,
    remainingDeadlineMs: 40 * 60_000,
  });
  assertEquals(decision.continue, false);
  assertEquals(decision.reason, "over_allowance");
});

Deno.test("warm-up overshoot: aborts GRQ-25 2h57m shape (#4067)", () => {
  const decision = decideWarmUpOvershoot({
    chunkElapsedMs: (2 * 60 + 57) * 60_000 + 31_000,
    perChunkMaxMs: 2 * 60_000,
    completedChunks: 1,
    totalChunks: 8,
    remainingDeadlineMs: 60 * 60_000,
  });
  assertEquals(decision.continue, false);
  assertEquals(decision.reason, "over_allowance");
});

Deno.test("warm-up overshoot: aborts when remaining cannot cover leftover chunks (#4067)", () => {
  const decision = decideWarmUpOvershoot({
    chunkElapsedMs: 3 * 60_000, // 1.5× of 2m — under 5× allowance
    perChunkMaxMs: 2 * 60_000,
    completedChunks: 1,
    totalChunks: 8,
    // 7 remaining × 2m = 14m needed; only 5m left.
    remainingDeadlineMs: 5 * 60_000,
  });
  assertEquals(decision.continue, false);
  assertEquals(decision.reason, "insufficient_remaining");
  assertEquals(decision.minNeededForRestMs, 7 * 2 * 60_000);
});

Deno.test("warm-up overshoot: last warm-up chunk with no leftovers continues (#4067)", () => {
  const decision = decideWarmUpOvershoot({
    chunkElapsedMs: 4 * 60_000,
    perChunkMaxMs: 2 * 60_000,
    completedChunks: 1,
    totalChunks: 1,
    remainingDeadlineMs: 0,
  });
  assertEquals(decision.continue, true);
  assertEquals(decision.reason, "within_allowance");
  assertEquals(decision.remainingChunks, 0);
});
