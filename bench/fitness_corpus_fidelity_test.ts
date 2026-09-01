/**
 * Issue #3926: the fidelity harness must measure every rate it was asked for
 * and cut each corpus to the size that rate names.
 *
 * Wall-clock is **not** asserted here. Tests run in parallel, so a real timing
 * assertion would be flaky (AGENTS.md testing policy); the harness therefore
 * takes an injectable clock and this test drives a virtual one, exactly as
 * `bench/score_per_hour_harness_test.ts` does. Real numbers belong in the
 * harness output and in `docs/evidence/fitness-corpus-fidelity-3926.md`.
 */

import { assertEquals } from "@std/assert";
import { measureFidelities } from "./fitness_corpus_fidelity.ts";

/** A clock that advances one unit per read — deterministic, never wall-clock. */
function virtualClock(): () => number {
  let tick = 0;
  return () => tick++;
}

Deno.test("fidelity harness - cuts one corpus per rate at the size it names", async () => {
  const measurements = await measureFidelities({
    records: 40,
    rates: [1, 0.5, 0.1],
    population: 1,
    seed: 3926,
    now: virtualClock(),
  });

  assertEquals(measurements.map((m) => m.rate), [1, 0.5, 0.1]);
  assertEquals(measurements.map((m) => m.records), [40, 20, 4]);
  assertEquals(
    measurements.map((m) => m.bytes),
    [40, 20, 4].map((n) => n * 2512 * 4),
  );
  // Under the virtual clock every timed pass reads the clock twice, so each
  // fidelity reports one unit and the ratios are exactly 1 — the arithmetic is
  // asserted without asserting on a machine's speed.
  assertEquals(measurements.map((m) => m.msPerGeneration), [1, 1, 1]);
  assertEquals(measurements.map((m) => m.ratioToFull), [1, 1, 1]);
});
