/**
 * Integration test: the evolve* functions return whole-run per-phase timing
 * totals alongside the single total `time` (Issue #3210).
 *
 * The aggregate simply sums the always-on per-generation phase timings that
 * are already streamed on `generation_complete` events, so the returned totals
 * must reconcile with those events: `generations` matches the event count and
 * each summed phase equals the sum of that phase across the events.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("evolveDataSet returns run-level phaseTimingTotals", async () => {
  await initWasmForTests();

  const events: GenerationCompleteEvent[] = [];
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(trainingSet, {
    iterations: 5,
    targetError: 0,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  const totals = result.phaseTimingTotals;
  assert(totals !== undefined, "phaseTimingTotals must be present");

  // generations tracks the number of aggregated generations.
  assert(events.length > 0, "should emit generation_complete events");
  assertEquals(
    totals.generations,
    events.length,
    "generations must match the number of generation_complete events",
  );

  // totalMs mirrors the returned run time.
  assertEquals(totals.totalMs, result.time);

  // Every bucket is a finite non-negative number.
  for (
    const [name, value] of Object.entries(totals) as [string, number][]
  ) {
    assertEquals(typeof value, "number", `${name} must be a number`);
    assert(Number.isFinite(value), `${name} must be finite`);
    assert(value >= 0, `${name} must be non-negative, got ${value}`);
  }

  // Summed fitness equals the sum of per-generation fitnessMs from the events.
  const expectedFitness = events.reduce(
    (sum, e) => sum + e.phaseTiming.fitnessMs,
    0,
  );
  assertEquals(
    totals.fitnessMs,
    expectedFitness,
    "fitnessMs must equal the summed per-generation fitness timings",
  );

  // The named buckets plus otherMs reconcile exactly with totalMs (unless
  // overlapping phases pushed otherMs to its 0 clamp).
  const named = totals.fitnessMs + totals.breedingMs + totals.mutationMs +
    totals.deduplicationMs + totals.speciationMs + totals.sortMs +
    totals.writeScoresMs + totals.checkpointWriteMs;
  if (totals.otherMs > 0) {
    assertEquals(
      named + totals.otherMs,
      totals.totalMs,
      "named buckets plus otherMs must reconcile with totalMs",
    );
  } else {
    // otherMs clamped at 0: named phases account for at least the wall-clock.
    assert(
      named >= totals.totalMs,
      "when otherMs is 0 the named phases should cover the wall-clock",
    );
  }
});
