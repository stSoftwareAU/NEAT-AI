/**
 * Issue #3926: the fidelity harness must measure every rate it was asked for
 * and cut each corpus to the size that rate names. Wall-clock is *not*
 * asserted here — timings belong in the harness output, never in a unit test.
 */

import { assertEquals } from "@std/assert";
import { measureFidelities } from "./fitness_corpus_fidelity.ts";

Deno.test("fidelity harness - cuts one corpus per rate at the size it names", async () => {
  const measurements = await measureFidelities({
    records: 40,
    rates: [1, 0.5, 0.1],
    population: 1,
    seed: 3926,
  });

  assertEquals(measurements.map((m) => m.rate), [1, 0.5, 0.1]);
  assertEquals(measurements.map((m) => m.records), [40, 20, 4]);
  assertEquals(
    measurements.map((m) => m.bytes),
    [40, 20, 4].map((n) => n * 2512 * 4),
  );
  assertEquals(measurements[0].ratioToFull, 1);
});
