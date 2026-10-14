import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  evolveDir,
  type EvolveDirDeps,
  evolveEnv,
  evolveRL,
} from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeFirstGenerationDeadlineTS } from "@neat/HardDeadline.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #4061: when the caller creature is disposed during a run (it is a
// member of the old population) and no champion is adopted, each entry point
// must restore the caller from its entry snapshot instead of leaving it empty.
// The run is driven by an injected clock (#2888): generation 1 disposes the
// caller and never settles, and the first-generation bound ends the run.

const TIMEOUT_MINUTES = 5;
// Constant far-future start. Every deadline is derived from it, so no real
// elapsed time is read.
const START_MS = Date.UTC(3000, 0, 1);

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/** Single-tick adapter that can never reach `targetError`. */
function buildEnvAdapter(): LegacyEpisodeAdapter<null, number> {
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

/** Single-tick RL adapter that can never reach `targetError`. */
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

interface Wedge {
  deps: EvolveDirDeps;
  logger: Logger;
  nowMS: number;
  evolveCalls: number;
  /** Neuron count observed straight after the caller was disposed. */
  neuronsAfterDispose: number;
}

/**
 * Build deps whose first `neat.evolve()` disposes the caller (as a generation
 * commit does in production), then never settles past the first-generation
 * bound. No champion is ever adopted, so the restore must use the snapshot.
 */
function disposeThenWedge(creature: Creature): Wedge {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  const wedge: Wedge = {
    deps: undefined as unknown as EvolveDirDeps,
    logger: { debug: record, info: record, warn: record, error: record },
    nowMS: START_MS,
    evolveCalls: 0,
    neuronsAfterDispose: -1,
  };
  wedge.deps = {
    startTimeMS: START_MS,
    now: () => wedge.nowMS,
    teardownBudgetMS: 1_000,
    onNeatReady: (neat) => {
      neat.evolve = ((..._args: unknown[]) => {
        wedge.evolveCalls++;
        creature.dispose();
        wedge.neuronsAfterDispose = creature.neurons.length;
        wedge.nowMS = computeFirstGenerationDeadlineTS(
          START_MS,
          TIMEOUT_MINUTES,
        )! + 60_000;
        return new Promise<never>(() => {});
      }) as Neat["evolve"];
    },
  };
  return wedge;
}

/** Assert the run was wedged with no champion and the caller got its genome back. */
function assertCallerRestored(
  creature: Creature,
  wedge: Wedge,
  result: { generation: number; terminationReason?: string },
  originalUUIDs: (string | undefined)[],
): void {
  assertEquals(wedge.evolveCalls, 1, "generation 1 must be entered once");
  assertEquals(
    wedge.neuronsAfterDispose,
    0,
    "the caller must be emptied during the run",
  );
  assertEquals(result.generation, 0, "no generation may be banked");
  assertEquals(
    result.terminationReason,
    "first-generation-wedged",
    "the first-generation bound must end the run with no champion",
  );

  assertEquals(
    creature.neurons.map((n) => n.uuid),
    originalUUIDs,
    "the caller must end with its original neuron UUIDs",
  );
  assert(
    creature.neurons.length >= creature.input + creature.output,
    `the caller must keep its input and output neurons, got ${creature.neurons.length}`,
  );
  creature.validate();
  assert(
    CreatureUtil.makeUUID(creature).length > 0,
    "the restored caller must produce a creature UUID",
  );
}

Deno.test({
  name:
    "evolveDir: a disposed caller with no champion is restored from its original genome (Issue #4061)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const originalUUIDs = creature.neurons.map((n) => n.uuid);
    const wedge = disposeThenWedge(creature);
    const priorLogger = getLogger();

    try {
      const result = await evolveDir(
        creature,
        dataSetDir,
        {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: wedge.logger,
        },
        wedge.deps,
      );
      assertCallerRestored(creature, wedge, result, originalUUIDs);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveEnv: a disposed caller with no champion is restored from its original genome (Issue #4061)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-" });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const originalUUIDs = creature.neurons.map((n) => n.uuid);
    const wedge = disposeThenWedge(creature);
    const priorLogger = getLogger();

    try {
      const result = await evolveEnv(creature, buildEnvAdapter(), {
        populationSize: 6,
        iterations: 500,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: wedge.logger,
      }, wedge.deps);
      assertCallerRestored(creature, wedge, result, originalUUIDs);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveRL: a disposed caller with no champion is restored from its original genome (Issue #4061)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-" });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const originalUUIDs = creature.neurons.map((n) => n.uuid);
    const wedge = disposeThenWedge(creature);
    const priorLogger = getLogger();

    try {
      const result = await evolveRL(creature, new UnreachableAdapter(), {
        populationSize: 6,
        iterations: 500,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: wedge.logger,
      }, wedge.deps);
      assertCallerRestored(creature, wedge, result, originalUUIDs);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
