/**
 * Integration guard for the population cap (Issue #3508).
 *
 * `evolve()` assembles the next population by concatenating elites, completed
 * training / discovery results, fine-tuned creatures, freshly bred offspring
 * and CRISPR (Clustered Regularly Interspaced Short Palindromic Repeats)
 * variants. Only the bred slice was budgeted, so a burst of heavy-pool results
 * landing in one generation grew the population — and the next generation's
 * fitness queue — to several times `populationSize`.
 *
 * Heavy-pool completions are stubbed rather than raced: each fabricated
 * training result yields four creatures (trained, backtracked, forward,
 * compact), exactly as a real worker response does, so the overflow is
 * reproduced deterministically on any runner. The assertion is behavioural —
 * the `populationSize` reported on every `generation_complete` event must stay
 * within the effective population size.
 */
import { assert, assertGreater } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Generations that receive a stubbed burst of heavy-pool completions. */
const BURST_GENERATIONS = 3;

/** Minimal 2-in / 1-out dataset; convergence is irrelevant here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/** A distinct creature, so the de-duplicator cannot cull the stub away. */
function variant(): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * A completed training response carrying the full set of variants a real
 * worker returns: the trained creature plus its backtracked, forward and
 * compact siblings — four population members from a single result.
 *
 * `trace` is omitted: the drain path treats it as optional (it only copies
 * predictive-coding tags across when present), so the stub stays minimal.
 */
function stubTrainingResult(taskID: number): ResponseData {
  // The compact variant carries the before/after topology tags a real
  // compaction records; the approach logger asserts on them.
  const compact = variant().exportJSON();
  addTag(compact, "old-neurons", "4");
  addTag(compact, "old-synapses", "6");

  return {
    taskID,
    duration: 1,
    train: {
      ID: `stub-train-${taskID}`,
      creature: variant().exportJSON(),
      error: 0.5,
      backtracked: variant().exportJSON(),
      forward: variant().exportJSON(),
      compact,
    },
  } as ResponseData;
}

Deno.test({
  name:
    "evolve keeps the population within the effective size when heavy-pool results land (Issue #3508)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const populationSize = 12;
    const options: NeatOptions = {
      populationSize,
      iterations: 3,
      targetError: 1e-9,
      threads: 1,
      trainPerGen: 0,
    };

    let neat: Neat | undefined;
    let nextTaskID = 1;
    const observed: { generation: number; size: number; cap: number }[] = [];

    options.onTrainingEvent = (event: TrainingEvent) => {
      if (event.kind !== "generation_complete") return;
      assert(neat, "onNeatReady must have handed back the Neat instance");
      observed.push({
        generation: event.generation,
        size: event.populationSize,
        cap: neat.effectivePopulationSize,
      });
      // Stub a burst of heavy-pool completions for the next generation:
      // 6 results × 4 creatures = 24 members on a budget of 12. Bounded to
      // the first few generations — draining results asks the loop for one
      // more generation, so feeding it forever would never terminate.
      if (observed.length >= BURST_GENERATIONS) return;
      for (let i = 0; i < 6; i++) {
        neat.trainingComplete.push(stubTrainingResult(nextTaskID++));
      }
    };

    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    await evolveDir(creature, dataSetDir, options, {
      onNeatReady: (instance) => {
        neat = instance;
        // Seed generation 1 as well, so every observed generation drains a
        // burst of completed heavy-pool work.
        for (let i = 0; i < 6; i++) {
          instance.trainingComplete.push(stubTrainingResult(nextTaskID++));
        }
      },
    });

    assertGreater(
      observed.length,
      1,
      "the run must complete more than one generation",
    );
    for (const entry of observed) {
      assert(
        entry.size <= entry.cap,
        `generation ${entry.generation}: population grew to ${entry.size}, ` +
          `above the effective population size of ${entry.cap}`,
      );
    }

    await Deno.remove(dataSetDir, { recursive: true });
  },
});
