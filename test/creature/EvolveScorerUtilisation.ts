/**
 * Integration test: the evolve* functions return whole-run per-backend
 * scorer-utilisation totals alongside `phaseTimingTotals` (Issue #3234).
 *
 * The run-level totals must match the backend `quality.sh` selected: WASM
 * comparison runs score on the per-creature path (zero batch invocations);
 * the default rust_scorer run batch-scores `forwardOnly` creatures. The
 * counts must also accumulate across generations — `generations` matches the
 * number of `generation_complete` events.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import { getEnvRustScorerConfig } from "../../src/score/RustScorerBridge.ts";
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

  // Issue #3871 removed the run-level fallback verdict along with the fallback
  // it reported, so every surviving field is a count again.
  for (const [name, value] of Object.entries(util)) {
    assertEquals(typeof value, "number", `${name} must be a number`);
    assert(Number.isFinite(value), `${name} must be finite`);
    assert(value >= 0, `${name} must be non-negative, got ${value}`);
    assertEquals(value, Math.trunc(value), `${name} must be an integer`);
  }

  const rust = getEnvRustScorerConfig();
  assert(
    util.creaturesBatchScored + util.creaturesPerCreatureScored > 0,
    "creatures must be scored on at least one backend",
  );
  if (rust.enabled && rust.batch) {
    assert(
      util.batchScorerInvocations > 0,
      "native batch rust_scorer must record invocations",
    );
    assert(
      util.creaturesBatchScored > 0,
      "native batch rust_scorer must score forward-only creatures",
    );
  } else {
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
    assert(
      util.creaturesPerCreatureScored > 0,
      "creatures must be scored on the per-creature path",
    );
  }
});
