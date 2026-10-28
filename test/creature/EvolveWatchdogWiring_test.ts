import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import {
  evolveDir,
  type EvolveDirDeps,
  evolveEnv,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type {
  EventLoopWatchdog,
  EventLoopWatchdogOptions,
  EventLoopWatchdogPhase,
} from "@neat/EventLoopWatchdog.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import type { Logger } from "@utils/Logger.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4067: `evolveDir`, `evolveEnv` and `evolveRL` arm the run's
 * event-loop watchdog, keep it in step with completed generations, and
 * disarm it on every exit. These tests run in-process with a recording
 * `deps.armWatchdog` stub, so no Worker is spawned and nothing is killed.
 *
 * The run starts far in the future, as in `EvolveEnvHardDeadline_test.ts`, so
 * no bound is reached and the normal path is what gets exercised.
 */

const START_MS = 4_000_000_000_000;
const TIMEOUT_MINUTES = 5;
// Not the 5-minute default, so a margin that is not passed through shows.
const MARGIN_MS = 120_000;
// With timeoutMinutes = 5 the hard cap is start + 10 min and generation 1's
// bound is start + 30 min. The run starts in the future, so the real clock is
// behind both bounds and each breach time is (bound + margin - start) / 1000.
const FIRST_LINE =
  "[Neat] First generation wedged after 1920s (event loop blocked past the first-generation bound; watchdog killing the process) — first-generation-wedged";
const RUN_LINE =
  "[Neat] Run wedged after 720s at generation {generation} (event loop blocked past the hard cap; watchdog killing the process)";
const STUCK_MESSAGE = "staged evolve failure";

type EntryPoint = "evolveDir" | "evolveEnv" | "evolveRL";

interface Recorded {
  options: EventLoopWatchdogOptions;
  disarms: number;
  generations: number[];
  phases: EventLoopWatchdogPhase[];
}

function recordingArm(): {
  armed: Recorded[];
  armWatchdog: (options: EventLoopWatchdogOptions) => EventLoopWatchdog;
} {
  const armed: Recorded[] = [];
  const armWatchdog = (
    options: EventLoopWatchdogOptions,
  ): EventLoopWatchdog => {
    const record: Recorded = {
      options,
      disarms: 0,
      generations: [],
      phases: [],
    };
    armed.push(record);
    return {
      disarm(): void {
        record.disarms++;
      },
      setGeneration(generation: number): void {
        record.generations.push(generation);
      },
      setPhase(phase: EventLoopWatchdogPhase): void {
        record.phases.push(phase);
      },
    };
  };
  return { armed, armWatchdog };
}

const QUIET_LOGGER: Logger = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
};

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

/**
 * Run one entry point with a tiny population. `timeoutMinutes` is passed
 * through as given, so `undefined` leaves the timeout unset. Returns the
 * completed generation count.
 */
async function runEntryPoint(
  entry: EntryPoint,
  deps: EvolveDirDeps,
  timeoutMinutes: number | undefined,
): Promise<number> {
  await initWasmForTests();
  const creatureStore = await Deno.makeTempDir({ prefix: "neat-4067-" });
  const options: NeatOptions = {
    populationSize: 6,
    iterations: 2,
    timeoutMinutes,
    threads: 1,
    creatureStore,
    logger: QUIET_LOGGER,
  };
  try {
    if (entry === "evolveDir") {
      const dataSetDir = makeDataDir(tinyDataSet(), 2000);
      try {
        const result = await evolveDir(
          new Creature(2, 1, { layers: [{ count: 3 }] }),
          dataSetDir,
          options,
          deps,
        );
        return result.generation;
      } finally {
        await Deno.remove(dataSetDir, { recursive: true });
      }
    }
    if (entry === "evolveEnv") {
      const result = await evolveEnv(
        new Creature(1, 1),
        buildLegacyAdapter(),
        options,
        deps,
      );
      return result.generation;
    }
    const result = await evolveRL(
      new Creature(1, 1),
      new UnreachableAdapter(),
      options,
      deps,
    );
    return result.generation;
  } finally {
    await Deno.remove(creatureStore, { recursive: true });
  }
}

/** The run's watchdog: first-generation bound, then the hard cap, then disarmed. */
function assertArmedThroughRun(armed: Recorded[], generation: number): void {
  assert(generation >= 1, "the run must complete at least one generation");
  assertEquals(armed.length, 2, "first-generation watchdog, then the hard cap");
  // The breach seconds are measured from the run start and include the
  // configured margin, so both must reach the watchdog.
  assertEquals(armed[0].options.breachLine, FIRST_LINE);
  assertEquals(
    armed[1].options.breachLine,
    RUN_LINE,
    "the hard-cap line names the generation at breach time",
  );
  assertEquals(armed[0].generations, [0]);
  assertEquals(
    armed[1].generations,
    Array.from({ length: generation }, (_, i) => i + 1),
    "the generation is set as each one completes",
  );
  for (const record of armed) {
    assertEquals(record.disarms, 1, "every handle is disarmed on return");
  }
}

for (const entry of ["evolveDir", "evolveEnv", "evolveRL"] as const) {
  Deno.test({
    name:
      `${entry}: arms the first-generation watchdog, re-arms the hard cap after generation 1, and disarms on return`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const { armed, armWatchdog } = recordingArm();
      const generation = await runEntryPoint(entry, {
        startTimeMS: START_MS,
        armWatchdog,
        watchdogMarginMS: MARGIN_MS,
      }, TIMEOUT_MINUTES);
      assertArmedThroughRun(armed, generation);
    },
  });

  Deno.test({
    name:
      `${entry}: a throw from the evolve loop still disarms the armed watchdog`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const { armed, armWatchdog } = recordingArm();
      await assertRejects(
        () =>
          runEntryPoint(entry, {
            startTimeMS: START_MS,
            armWatchdog,
            watchdogMarginMS: MARGIN_MS,
            onNeatReady: (neat: Neat) => {
              neat.evolve = () => {
                throw new Error(STUCK_MESSAGE);
              };
            },
          }, TIMEOUT_MINUTES),
        Error,
        STUCK_MESSAGE,
      );
      assertEquals(armed.length, 1, "only the first-generation watchdog armed");
      assertEquals(armed[0].disarms, 1, "the handle is disarmed on the throw");
    },
  });
}

/**
 * Issue #4096: the generation phases reach the watchdog, so its breach line
 * can name the phase the main thread was in. Phases from every armed handle
 * are concatenated in arm order, which is the order the run emitted them.
 */
for (const entry of ["evolveDir", "evolveEnv", "evolveRL"] as const) {
  Deno.test({
    name:
      `${entry}: generation phases reach the watchdog, fitness before mutation, and stop once the run returns`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const { armed, armWatchdog } = recordingArm();
      let neatRef: Neat | undefined;
      const generation = await runEntryPoint(entry, {
        startTimeMS: START_MS,
        armWatchdog,
        watchdogMarginMS: MARGIN_MS,
        onNeatReady: (neat: Neat) => {
          neatRef = neat;
        },
      }, TIMEOUT_MINUTES);
      assert(generation >= 1, "the run must complete at least one generation");

      const phases = armed.flatMap((record) => record.phases);
      assert(phases.includes("fitness"), "fitness phase is reported");
      assert(phases.includes("mutation"), "mutation phase is reported");
      assert(
        phases.indexOf("fitness") < phases.indexOf("mutation"),
        "fitness is reported before mutation",
      );

      // The observer is cleared on return, so a late marker reaches nothing.
      const reported = phases.length;
      assert(neatRef !== undefined, "onNeatReady hands over the Neat instance");
      neatRef.markPhase("fitness");
      assertEquals(
        armed.flatMap((record) => record.phases).length,
        reported,
        "no phase reaches the watchdog after the run returns",
      );
    },
  });
}

Deno.test({
  name: "evolveDir: without timeoutMinutes the watchdog is never armed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { armed, armWatchdog } = recordingArm();
    const generation = await runEntryPoint(
      "evolveDir",
      { startTimeMS: START_MS, armWatchdog, watchdogMarginMS: MARGIN_MS },
      undefined,
    );
    assert(generation >= 1, "the run must still complete a generation");
    assertEquals(armed.length, 0);
  },
});
