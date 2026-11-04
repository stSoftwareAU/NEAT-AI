/**
 * A deadline-stopped native run that measured no full error (Issue #4119).
 *
 * The trainer's `error` is then only the incumbent's, so `scheduleTraining`
 * must queue the changed weights without scoring them from it; a stopped run
 * that did reach a full measure is scored as any other result.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { Neat } from "@neat/Neat.ts";
import { isUnmeasuredTimeout, scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { TrainingGainLog } from "@archive/TrainingGainLog.ts";
import { readTrainingGainLog } from "@archive/TrainingGainRecord.ts";
import { resolveTrainingGainLogConfig } from "@config/TrainingGainLogConfig.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { initWasmForTests } from "../_initWasm.ts";

type Measure = "full" | "partial" | "unmeasured";

function incumbent(): Creature {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly: true,
  });
  CreatureUtil.makeUUID(creature);
  addTag(creature, "error", "0.5");
  creature.score = -0.5;
  return creature;
}

/** A stopped-by-deadline reply: changed weights, error 0.5 (the incumbent's). */
function stoppedReply(measure: Measure) {
  return (creature: Creature): ResponseData => {
    const trained = Creature.fromJSON(creature.exportJSON());
    for (const synapse of trained.synapses) synapse.weight *= 0.5;
    return {
      taskID: 1,
      duration: 10,
      train: {
        ID: creature.uuid!,
        creature: exportJSONWithRuntimeIds(trained),
        error: measure === "full" ? 0.25 : 0.5,
        timedOut: true,
        bestMeasure: measure,
        trace: {
          input: creature.input,
          output: creature.output,
          neurons: [],
          synapses: [],
        },
      },
    };
  };
}

async function run(measure: Measure) {
  await initWasmForTests();
  const directory = await Deno.makeTempDir({ prefix: "unmeasured-timeout-" });
  try {
    const log = new TrainingGainLog(
      resolveTrainingGainLogConfig({
        enabled: true,
        directory,
        runId: "unmeasured-run",
      }),
    );
    const queued: ResponseData[] = [];
    const reply = stoppedReply(measure);
    const worker = {
      train: (c: Creature) => Promise.resolve(reply(c)),
      trainTracked: (c: Creature) => ({
        taskID: 1,
        response: Promise.resolve(reply(c)),
      }),
    };
    const pool = { selectWorker: () => worker, getIdleWorkers: () => [] };
    const neat = {
      config: createNeatConfig({}),
      currentGeneration: 9,
      hardDeadlineTS: 0,
      abandonEpoch: 0,
      trainingInProgress: new Map(),
      trainingDeadlines: new Map(),
      trainingTasks: new Map(),
      alreadyScheduledMap: new Map<string, number>(),
      trainingRegressionTracker: new TrainingRegressionTracker(),
      trainingGainLog: log,
      heavyWorkerPool: pool,
      fastWorkerPool: pool,
      isRunAbandonedSince: () => false,
      recordTrainingComplete: (_u: string, _e: number, r: ResponseData) => {
        queued.push(r);
        return true;
      },
    } as unknown as Neat;

    scheduleTraining(neat, incumbent(), 5, { rank: 1, rankedPopulation: 4 });
    await Promise.all(neat.trainingInProgress.values());
    await log.flush();
    return { queued, records: await readTrainingGainLog(log.path) };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("deadline stop: a partial measure queues the weights without a score", async () => {
  const { queued, records } = await run("partial");
  assertEquals(queued.length, 1, "the changed weights are still queued");
  assertEquals(queued[0].train?.backtracked, undefined);
  assertEquals(queued[0].train?.forward, undefined);
  assertEquals(records.length, 1);
  assertEquals(records[0].outcome, "trained");
  assertEquals(records[0].scoreAfter, undefined);
  assertEquals(records[0].errorAfter, undefined);
});

Deno.test("deadline stop: an unmeasured stop queues the weights without a score", async () => {
  const { queued, records } = await run("unmeasured");
  assertEquals(queued.length, 1);
  assertEquals(records[0].scoreAfter, undefined);
  assertEquals(records[0].errorAfter, undefined);
});

Deno.test("deadline stop: a full measure is scored like any other result", async () => {
  const { queued, records } = await run("full");
  assertEquals(queued.length, 1);
  assertEquals(records[0].errorAfter, 0.25);
  assert(
    records[0].scoreAfter !== undefined &&
      records[0].scoreAfter > records[0].scoreBefore,
  );
});

Deno.test("isUnmeasuredTimeout: only a stopped run without a full measure", () => {
  assertEquals(
    isUnmeasuredTimeout({ timedOut: true, bestMeasure: "partial" }),
    true,
  );
  assertEquals(
    isUnmeasuredTimeout({ timedOut: true, bestMeasure: "unmeasured" }),
    true,
  );
  assertEquals(
    isUnmeasuredTimeout({ timedOut: true, bestMeasure: "full" }),
    false,
  );
  assertEquals(
    isUnmeasuredTimeout({ timedOut: false, bestMeasure: "partial" }),
    false,
  );
  assertEquals(isUnmeasuredTimeout({ timedOut: true }), false);
  assertEquals(isUnmeasuredTimeout({}), false);
});
