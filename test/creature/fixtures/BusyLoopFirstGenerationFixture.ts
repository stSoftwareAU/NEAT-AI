/**
 * Subprocess fixture for `test/creature/EvolveFirstGenerationBusyLoop_test.ts`
 * (Issue #4067, part of #4060). Run as
 * `deno run ... BusyLoopFirstGenerationFixture.ts <dir|env|rl>`.
 *
 * `neat.evolve` is replaced with a synchronous `for (;;) {}`. The loop never
 * yields, so the in-process bound cannot fire. Only the off-main-thread
 * watchdog armed by the entry point can end the process.
 *
 * The watchdog is real here: no `armWatchdog` stub. The run starts 24 h in
 * the past, so generation 1's bound has already passed, and `watchdogMarginMS`
 * is 0, so the Worker breaches on its first check.
 *
 * This file has no `Deno.test`. The test spawns it as a child process.
 */

import { Creature } from "@creature";
import {
  evolveDir,
  type EvolveDirDeps,
  evolveEnv,
  evolveRL,
} from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../../_initWasm.ts";

function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

function buildLegacyAdapter(): LegacyEpisodeAdapter<null, number> {
  return {
    inputCount: 1,
    outputCount: 1,
    maxSteps: 1,
    reset(_seed?: number): null {
      return null;
    },
    observe(_state: null): Float32Array {
      return new Float32Array([1.0]);
    },
    decode(output: Float32Array): number {
      return output[0];
    },
    step(_state: null, action: number) {
      return { state: null, reward: -Math.abs(action - 99), done: true };
    },
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

const mode = Deno.args[0];
if (mode !== "dir" && mode !== "env" && mode !== "rl") {
  throw new Error(`unknown mode: ${mode}`);
}

await initWasmForTests();
const creatureStore = await Deno.makeTempDir({ prefix: "busy-loop-4067-" });
const deps: EvolveDirDeps = {
  startTimeMS: Date.now() - 24 * 60 * 60_000,
  watchdogMarginMS: 0,
  onNeatReady: (neat: Neat) => {
    neat.evolve = (() => {
      for (;;) {
        // Busy loop: never yields to the event loop.
      }
    }) as typeof neat.evolve;
  },
};
const options = {
  populationSize: 6,
  iterations: 500,
  timeoutMinutes: 5,
  threads: 1,
  creatureStore,
};

if (mode === "dir") {
  const dataSetDir = makeDataDir(tinyDataSet(), 2000);
  await evolveDir(
    new Creature(2, 1, { layers: [{ count: 3 }] }),
    dataSetDir,
    options,
    deps,
  );
} else if (mode === "env") {
  await evolveEnv(new Creature(1, 1), buildLegacyAdapter(), options, deps);
} else {
  await evolveRL(new Creature(1, 1), new UnreachableAdapter(), options, deps);
}
