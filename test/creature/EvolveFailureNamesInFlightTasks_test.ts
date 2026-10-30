import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  evolveDir,
  type EvolveDirDeps,
  evolveEnv,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #4099 (PR #4104 review): a run whose generation throws takes the
// Issue #4072 failure cleanup, not the bounded teardown. That path must still
// give every scheduled training task a terminal line: a task still in flight is
// named as abandoned, and a result that settled but was never merged is named
// as discarded. The run is failed by replacing `neat.evolve` with a rejection;
// the injected clock (#2888) means no real elapsed time is read.

const START_MS = Date.UTC(3000, 0, 1);
const STUCK_ID = "stuck-4099-train-task";
const SETTLED_UUID = "settled-4099-task";
const SETTLED_ID = "settled4099";

function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

function buildEnvAdapter(): LegacyEpisodeAdapter<null, number> {
  return {
    inputCount: 1,
    outputCount: 1,
    maxSteps: 1,
    reset: () => null,
    observe: () => new Float32Array([1.0]),
    decode: (output: Float32Array) => output[0],
    step: (_state: null, action: number) => ({
      state: null,
      reward: -Math.abs(action - 99),
      done: true,
    }),
  };
}

class UnreachableAdapter extends EpisodeAdapter<null, number> {
  override reset(_seed: number): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([1.0]), state: null };
  }
  override step(
    _state: null,
    action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: -Math.abs(action - 99),
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 1;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
  override maxSteps(): number {
    return 1;
  }
}

/** Records every log line so the terminal lines can be read back. */
function recorder(lines: string[]): Logger {
  const push = (...a: unknown[]) => lines.push(a.join(" "));
  return { debug: push, info: push, warn: push, error: push };
}

/**
 * Leave one task in flight and one settled-but-unmerged result on `neat`, then
 * make the first `evolve()` reject with `failure`.
 */
function strandWorkThenFail(neat: Neat, failure: Error, lines: string[]): void {
  // Installed after construction: the Neat constructor resets the logger.
  setLogger(recorder(lines));
  neat.trainingInProgress.set(STUCK_ID, new Promise<void>(() => {}));
  neat.trainingInProgress.set(SETTLED_UUID, Promise.resolve());
  const recorded = neat.recordTrainingComplete(
    SETTLED_UUID,
    neat.abandonEpoch,
    {
      taskID: 1,
      duration: 1,
      train: {
        ID: SETTLED_ID,
        creature: new Creature(2, 1).exportJSON(),
        error: 0.5,
      },
    } as never,
  );
  assert(recorded, "positive control: the settled result must be queued");
  assertEquals(neat.trainingComplete.length, 1);
  neat.evolve = (() => Promise.reject(failure)) as Neat["evolve"];
}

function assertTasksNamed(lines: string[], failure: Error, caught: unknown) {
  assertEquals(caught, failure, "the original rejection must be rethrown");
  const text = lines.join("\n");
  assert(
    text.includes(
      `Training ${STUCK_ID.substring(STUCK_ID.length - 8)} abandoned`,
    ),
    `the in-flight task must be named as abandoned; got: ${text}`,
  );
  assert(
    text.includes(`Training ${SETTLED_ID} discarded at teardown`),
    `the settled-but-unmerged result must be named as discarded; got: ${text}`,
  );
}

function assertNothingStranded(neat: Neat | undefined) {
  assert(neat, "onNeatReady must have handed back the Neat instance");
  assertEquals(neat.trainingInProgress.size, 0);
  assertEquals(neat.trainingComplete.length, 0);
}

Deno.test({
  name:
    "evolveDir: a rejected generation names in-flight and unmerged training tasks (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const prior = getLogger();
    const lines: string[] = [];
    let captured: Neat | undefined;
    const deps: EvolveDirDeps = {
      startTimeMS: START_MS,
      now: () => START_MS,
      onNeatReady: (neat) => {
        captured = neat;
        strandWorkThenFail(neat, failure, lines);
      },
    };
    try {
      let caught: unknown;
      try {
        await evolveDir(creature, dataSetDir, {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: 5,
          threads: 1,
        }, deps);
      } catch (error) {
        caught = error;
      }
      assertTasksNamed(lines, failure, caught);
      assertNothingStranded(captured);
    } finally {
      setLogger(prior);
      await Deno.remove(dataSetDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveEnv: a rejected generation names in-flight and unmerged training tasks (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const prior = getLogger();
    const lines: string[] = [];
    let captured: Neat | undefined;
    const deps: EvolveDirDeps = {
      startTimeMS: START_MS,
      now: () => START_MS,
      onNeatReady: (neat) => {
        captured = neat;
        strandWorkThenFail(neat, failure, lines);
      },
    };
    try {
      let caught: unknown;
      try {
        await evolveEnv(creature, buildEnvAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: 5,
          threads: 1,
        }, deps);
      } catch (error) {
        caught = error;
      }
      assertTasksNamed(lines, failure, caught);
      assertNothingStranded(captured);
    } finally {
      setLogger(prior);
    }
  },
});

Deno.test({
  name:
    "evolveRL: a rejected generation names in-flight and unmerged training tasks (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const prior = getLogger();
    const lines: string[] = [];
    let captured: Neat | undefined;
    const deps: EvolveDirDeps = {
      startTimeMS: START_MS,
      now: () => START_MS,
      onNeatReady: (neat) => {
        captured = neat;
        strandWorkThenFail(neat, failure, lines);
      },
    };
    try {
      let caught: unknown;
      try {
        await evolveRL(creature, new UnreachableAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: 5,
          threads: 1,
        }, deps);
      } catch (error) {
        caught = error;
      }
      assertTasksNamed(lines, failure, caught);
      assertNothingStranded(captured);
    } finally {
      setLogger(prior);
    }
  },
});
