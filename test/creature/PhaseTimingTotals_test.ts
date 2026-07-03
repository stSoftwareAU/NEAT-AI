/**
 * Unit tests for the whole-run per-phase timing aggregation used by the
 * `evolve*` functions (Issue #3210).
 *
 * The aggregator sums the always-on per-generation {@link GenerationPhaseTiming}
 * across the run and derives an `otherMs` reconciliation bucket from the run's
 * total wall-clock time.
 */

import { assert, assertEquals } from "@std/assert";
import type { GenerationPhaseTiming } from "@config/TrainingEvent.ts";
import {
  accumulatePhaseTiming,
  createPhaseTimingAccumulator,
  finalisePhaseTimingTotals,
} from "@creature/PhaseTimingTotals.ts";

/** Build a GenerationPhaseTiming with sensible defaults for the required fields. */
function timing(
  overrides: Partial<GenerationPhaseTiming> = {},
): GenerationPhaseTiming {
  return {
    fitnessMs: 0,
    breedingMs: 0,
    resultProcessingMs: 0,
    totalMs: 0,
    ...overrides,
  };
}

Deno.test("PhaseTimingTotals: empty accumulator finalises to zeros", () => {
  const acc = createPhaseTimingAccumulator();
  const totals = finalisePhaseTimingTotals(acc, 0);
  assertEquals(totals.generations, 0);
  assertEquals(totals.totalMs, 0);
  assertEquals(totals.fitnessMs, 0);
  assertEquals(totals.breedingMs, 0);
  assertEquals(totals.mutationMs, 0);
  assertEquals(totals.deduplicationMs, 0);
  assertEquals(totals.speciationMs, 0);
  assertEquals(totals.sortMs, 0);
  assertEquals(totals.writeScoresMs, 0);
  assertEquals(totals.checkpointWriteMs, 0);
  assertEquals(totals.otherMs, 0);
});

Deno.test("PhaseTimingTotals: sums the major phases across generations", () => {
  const acc = createPhaseTimingAccumulator();
  accumulatePhaseTiming(
    acc,
    timing({
      fitnessMs: 100,
      breedingMs: 10,
      mutationMs: 5,
      deduplicationMs: 4,
      speciationMs: 3,
      sortMs: 2,
      writeScoresMs: 1,
      checkpointWriteMs: 6,
    }),
  );
  accumulatePhaseTiming(
    acc,
    timing({
      fitnessMs: 200,
      breedingMs: 20,
      mutationMs: 5,
      deduplicationMs: 6,
      speciationMs: 7,
      sortMs: 8,
      writeScoresMs: 9,
      checkpointWriteMs: 4,
    }),
  );

  const totals = finalisePhaseTimingTotals(acc, 500);
  assertEquals(totals.generations, 2);
  assertEquals(totals.totalMs, 500);
  assertEquals(totals.fitnessMs, 300);
  assertEquals(totals.breedingMs, 30);
  assertEquals(totals.mutationMs, 10);
  assertEquals(totals.deduplicationMs, 10);
  assertEquals(totals.speciationMs, 10);
  assertEquals(totals.sortMs, 10);
  assertEquals(totals.writeScoresMs, 10);
  assertEquals(totals.checkpointWriteMs, 10);
  // 500 - (300+30+10+10+10+10+10+10) = 110
  assertEquals(totals.otherMs, 110);
});

Deno.test("PhaseTimingTotals: optional phases default to zero when absent", () => {
  const acc = createPhaseTimingAccumulator();
  // Only the required fields present — mutation/dedup/etc. omitted.
  accumulatePhaseTiming(acc, timing({ fitnessMs: 50, breedingMs: 5 }));
  const totals = finalisePhaseTimingTotals(acc, 60);
  assertEquals(totals.fitnessMs, 50);
  assertEquals(totals.breedingMs, 5);
  assertEquals(totals.mutationMs, 0);
  assertEquals(totals.deduplicationMs, 0);
  assertEquals(totals.otherMs, 5);
});

Deno.test("PhaseTimingTotals: named buckets plus otherMs reconcile to totalMs", () => {
  const acc = createPhaseTimingAccumulator();
  accumulatePhaseTiming(
    acc,
    timing({ fitnessMs: 80, breedingMs: 10, sortMs: 5 }),
  );
  const runTotalMs = 120;
  const t = finalisePhaseTimingTotals(acc, runTotalMs);
  const sum = t.fitnessMs + t.breedingMs + t.mutationMs + t.deduplicationMs +
    t.speciationMs + t.sortMs + t.writeScoresMs + t.checkpointWriteMs +
    t.otherMs;
  assertEquals(sum, runTotalMs);
});

Deno.test("PhaseTimingTotals: otherMs clamps at 0 when phases overlap wall-clock", () => {
  const acc = createPhaseTimingAccumulator();
  // Summed named phases (300) exceed the run wall-clock (150) due to
  // pipelined/overlapping phases — otherMs must not go negative.
  accumulatePhaseTiming(acc, timing({ fitnessMs: 250, breedingMs: 50 }));
  const totals = finalisePhaseTimingTotals(acc, 150);
  assertEquals(totals.otherMs, 0);
  assert(totals.otherMs >= 0, "otherMs must never be negative");
});
