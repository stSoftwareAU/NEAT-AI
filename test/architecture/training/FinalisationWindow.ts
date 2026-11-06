/**
 * Native adapter finalisation is bounded by the original deadline plus the
 * watchdog grace (Issue #4119). Deadlines are fixed epoch constants; no clock
 * is read.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { isFinalisationWindowSpent } from "@architecture/training/RustTrainDirBridge.ts";
import { finaliseTraining } from "@architecture/training/TrainingTeardown.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { TRAINING_TASK_WATCHDOG_GRACE_MS } from "@neat/PerTaskTrainingTimeout.ts";
import { initWasmForTests } from "../../_initWasm.ts";

const DEADLINE = 1_800_000_000_000;

Deno.test("finalisation window: open up to deadline plus grace, spent after", () => {
  const edge = DEADLINE + TRAINING_TASK_WATCHDOG_GRACE_MS;
  assertEquals(isFinalisationWindowSpent(DEADLINE, DEADLINE), false);
  assertEquals(isFinalisationWindowSpent(DEADLINE, edge), false);
  assertEquals(isFinalisationWindowSpent(DEADLINE, edge + 1), true);
});

Deno.test("finalisation window: a task with no deadline is never spent", () => {
  assertEquals(isFinalisationWindowSpent(0, Number.MAX_SAFE_INTEGER), false);
});

function trainedCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.3 },
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.8 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
    forwardOnly: true,
  });
}

Deno.test("finaliseTraining: skipCompaction returns the trained creature with no compacted copy", async () => {
  await initWasmForTests();
  const creature = trainedCreature();
  const loop = {
    iteration: 1,
    bestError: 0.5,
    bestCreatureJSON: creature.exportJSON(),
    bestTraceJSON: creature.traceJSON(),
    sparseConfig: undefined as never,
    timedOut: true,
  };
  const skipped = finaliseTraining(
    creature,
    loop,
    // deno-lint-ignore no-explicit-any
    { plankConstant: 1e-7 } as any,
    1,
    false,
    undefined,
    "skip-id",
    { skipCompaction: true },
  );
  assertEquals(skipped.ID, "skip-id");
  assertEquals(skipped.error, 0.5);
  assertEquals(skipped.compact, undefined);
  assert(skipped.trace !== undefined, "the trace is still returned");
});

function finalise(
  skipCompaction: boolean | (() => boolean),
  creature = trainedCreature(),
  traced = false,
) {
  const loop = {
    iteration: 1,
    bestError: 0.5,
    bestCreatureJSON: exportJSONWithRuntimeIds(creature),
    bestTraceJSON: creature.traceJSON(),
    sparseConfig: { traceNeeded: () => true } as never,
    timedOut: true,
  };
  if (traced) {
    loop.bestTraceJSON.neurons[0].trace = {
      count: 1,
      totalBias: 0,
      totalAdjustedBias: 0,
      hintValue: 0,
      maximumActivation: 1,
      minimumActivation: 0,
    };
  }
  return finaliseTraining(
    creature,
    loop,
    // deno-lint-ignore no-explicit-any
    { plankConstant: 1e-7 } as any,
    1,
    false,
    undefined,
    "ask-id",
    { skipCompaction },
  );
}

Deno.test("finaliseTraining: an expired window skips trace compaction", async () => {
  await initWasmForTests();
  assert(finalise(false, trainedCreature(), true).compact !== undefined);
  assertEquals(
    finalise(() => true, trainedCreature(), true).compact,
    undefined,
  );
});

Deno.test("finaliseTraining: window closes before variant compaction", async () => {
  await initWasmForTests();
  const makeCreature = () => {
    const json = trainedCreature().exportJSON();
    json.neurons[0].squash = "IDENTITY";
    json.neurons[0].bias = 0;
    return Creature.fromJSON(json);
  };
  assert(finalise(false, makeCreature()).compact !== undefined);
  let asked = 0;
  const result = finalise(() => ++asked === 2, makeCreature());
  assertEquals(asked, 2);
  assertEquals(result.compact, undefined);
});

Deno.test("finaliseTraining: a budget that is spent when asked drops the compacted copy", async () => {
  await initWasmForTests();
  let asked = 0;
  const result = finalise(() => {
    asked++;
    return true;
  });
  assertEquals(asked, 1, "asked once, then stopped");
  assertEquals(result.compact, undefined);
  assert(result.trace !== undefined, "the trace is still returned");
});

Deno.test("finaliseTraining: a budget that is still open when asked finalises as if never asked", async () => {
  await initWasmForTests();
  let asked = 0;
  const result = finalise(() => {
    asked++;
    return false;
  });
  assert(asked >= 1, "the budget is asked before compacting");
  const unasked = finalise(false);
  assertEquals(result.compact, unasked.compact);
  assertEquals(result.error, unasked.error);
  assertEquals(result.ID, "ask-id");
});
