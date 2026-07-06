/**
 * Integration test: the evolve* functions return whole-run per-backend
 * scorer-utilisation totals alongside `phaseTimingTotals` (Issue #3234).
 *
 * With the native batch rust scorer disabled (the default in this test
 * environment) every creature is scored on the per-creature worker path, so
 * the run-level totals must show all scoring under `creaturesPerCreatureScored`
 * with zero batch invocations and zero fallback generations. The counts must
 * also accumulate across generations — `generations` matches the number of
 * `generation_complete` events.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("evolveDataSet returns run-level scorerUtilisation", async () => {
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

  const util = result.scorerUtilisation;
  assert(util !== undefined, "scorerUtilisation must be present");

  // generations tracks the number of aggregated generations.
  assert(events.length > 0, "should emit generation_complete events");
  assertEquals(
    util.generations,
    events.length,
    "generations must match the number of generation_complete events",
  );

  // Every count is a finite non-negative integer.
  for (const [name, value] of Object.entries(util) as [string, number][]) {
    assertEquals(typeof value, "number", `${name} must be a number`);
    assert(Number.isFinite(value), `${name} must be finite`);
    assert(value >= 0, `${name} must be non-negative, got ${value}`);
    assertEquals(value, Math.trunc(value), `${name} must be an integer`);
  }

  // Batch scoring is disabled in this environment: everything is per-creature,
  // no batch process was spawned, and no generation hit a fallback.
  assertEquals(
    util.batchScorerInvocations,
    0,
    "no batch scorer process without the native binary enabled",
  );
  assertEquals(
    util.creaturesBatchScored,
    0,
    "no creatures batch-scored without batch mode",
  );
  assertEquals(
    util.batchFallbackGenerations,
    0,
    "a healthy per-creature run has zero batch fallbacks",
  );
  // Real scoring happened across the run on the per-creature path.
  assert(
    util.creaturesPerCreatureScored > 0,
    "creatures must be scored on the per-creature path",
  );
});
