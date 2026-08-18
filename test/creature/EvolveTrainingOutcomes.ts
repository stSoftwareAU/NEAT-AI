/**
 * Integration test: the evolve* functions report run-level training outcome
 * totals (Issue #3779).
 *
 * GRQ's run-end summary cannot see how many training dispatches were skipped
 * unless `verbose` is on, so the counters ride on the result object where any
 * consumer can print them.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("evolveDataSet returns run-level trainingOutcomes", async () => {
  await initWasmForTests();

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(trainingSet, {
    iterations: 3,
    targetError: 0,
    populationSize: 10,
    threads: 1,
  });

  const outcomes = result.trainingOutcomes;
  assert(outcomes !== undefined, "trainingOutcomes must be present");

  for (
    const name of [
      "improvements",
      "regressions",
      "noChange",
      "skipped",
    ] as const
  ) {
    const value = outcomes[name];
    assertEquals(typeof value, "number", `${name} must be a number`);
    assert(Number.isFinite(value), `${name} must be finite`);
    assert(value >= 0, `${name} must be non-negative, got ${value}`);
    assertEquals(value, Math.trunc(value), `${name} must be an integer`);
  }

  assert(
    outcomes.regressionRate >= 0 && outcomes.regressionRate <= 1,
    `regressionRate must be a fraction, got ${outcomes.regressionRate}`,
  );
});
