import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  type EvolveDirDeps,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  computeFirstGenerationDeadlineTS,
  computeHardDeadlineTS,
} from "@neat/HardDeadline.ts";
import type { TrainingTaskHandle } from "@neat/TrainingTaskHandle.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4056: `evolveRL` must bound `neat.evolve()` by the same deadlines as
 * `evolveDir` (Issue #4053 / GRQ #4470). A generation that never settles ends
 * the run at its own bound instead of hanging, driven by an injected clock so
 * the test makes no elapsed-time assertions.
 */

/** Single-tick adapter that can never reach `targetError`. */
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

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  return {
    logger: { debug: record, info: record, warn: record, error: record },
    lines,
  };
}

/** Fail loudly instead of hanging the suite if the call never returns. */
function withRealTimeGuard<T>(
  work: Promise<T>,
  label: string,
  timeoutMS = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: evolveRL did not return`)),
      timeoutMS,
    );
  });
  return Promise.race([work, guard]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

const TIMEOUT_MINUTES = 5;
// Far-future fixed start: the soft end-time is then still ahead of the real
// wall clock that `finishGeneration` reads, so the run is not "completed"
// after generation 1 and later generations stay reachable.
const START_MS = 4_000_000_000_000;
const STUCK_KEY = "stuck-training-0c7db7ab";

interface Harness {
  deps: EvolveDirDeps;
  lines: string[];
  logger: Logger;
  creatureStore: string;
  state: {
    nowMS: number;
    /** One-shot hook run on each injected-clock read (watchdog poll). */
    onNow?: () => void;
    evolveCalls: number;
    captured?: Neat;
    cancelCalls: Array<{ taskID: number; reason: string }>;
    quarantineCalls: number;
  };
}

/**
 * `behave(call, neat, original, state)` replaces `neat.evolve`; `call` is the
 * 1-based call number and `original` the real evolve bound to `neat`.
 */
async function makeHarness(
  behave: (
    call: number,
    neat: Neat,
    original: Neat["evolve"],
    h: Harness,
    registerStuck: () => void,
  ) => Promise<unknown>,
): Promise<Harness> {
  const creatureStore = await Deno.makeTempDir({ prefix: "neat-4056-" });
  const { logger, lines } = makeRecordingLogger();
  const state: Harness["state"] = {
    nowMS: START_MS,
    evolveCalls: 0,
    cancelCalls: [],
    quarantineCalls: 0,
  };
  const fakeWorker = {
    cancelTask(taskID: number, reason: string): boolean {
      state.cancelCalls.push({ taskID, reason });
      return true;
    },
    quarantine(): void {
      state.quarantineCalls++;
    },
  };
  const h: Harness = {
    lines,
    logger,
    creatureStore,
    state,
    deps: {
      startTimeMS: START_MS,
      now: () => {
        state.onNow?.();
        return state.nowMS;
      },
      teardownBudgetMS: 1_000,
      onNeatReady: (neat) => {
        state.captured = neat;
        const original = neat.evolve.bind(neat);
        const registerStuck = () => {
          neat.trainingInProgress.set(STUCK_KEY, new Promise<void>(() => {}));
          neat.trainingTasks.set(
            STUCK_KEY,
            { worker: fakeWorker, taskID: 42 } as unknown as TrainingTaskHandle,
          );
        };
        neat.evolve = ((..._args: unknown[]) => {
          state.evolveCalls++;
          return behave(state.evolveCalls, neat, original, h, registerStuck);
        }) as Neat["evolve"];
      },
    },
  };
  return h;
}

function assertClean(h: Harness) {
  const neat = h.state.captured;
  assert(neat, "onNeatReady must have handed back the Neat instance");
  assertEquals(neat.trainingInProgress.size, 0);
  assertEquals(neat.discoveryInProgress.size, 0);
  assertEquals(h.state.cancelCalls.length, 1, "the stuck task is cancelled");
  assertEquals(h.state.cancelCalls[0].taskID, 42);
  assertEquals(h.state.quarantineCalls, 0, "no worker quarantine");
}

async function run(
  name: string,
  behave: Parameters<typeof makeHarness>[0],
  check: (
    result: Awaited<ReturnType<typeof evolveRL>>,
    h: Harness,
  ) => void,
  overrides: {
    iterations?: number;
    statistics?: boolean;
    deps?: Partial<EvolveDirDeps>;
  } = {},
) {
  await initWasmForTests();
  const h = await makeHarness(behave);
  Object.assign(h.deps, overrides.deps);
  const creature = new Creature(1, 1);
  const priorLogger = getLogger();
  try {
    const result = await withRealTimeGuard(
      evolveRL(creature, new UnreachableAdapter(), {
        populationSize: 6,
        iterations: overrides.iterations ?? 500,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore: h.creatureStore,
        logger: h.logger,
        episodesPerCreature: 1,
        seed: 7,
        statistics: overrides.statistics,
      }, h.deps),
      name,
    );
    check(result, h);
  } finally {
    setLogger(priorLogger);
    await Deno.remove(h.creatureStore, { recursive: true });
  }
}

Deno.test({
  name: "evolveRL: a first generation that never settles ends at its bound",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "first generation wedged",
      (_call, _neat, _orig, h, registerStuck) => {
        registerStuck();
        h.state.nowMS =
          computeFirstGenerationDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        return new Promise<never>(() => {});
      },
      (result, h) => {
        assertEquals(result.terminationReason, "first-generation-wedged");
        assertEquals(result.generation, 0);
        assertEquals(h.state.evolveCalls, 1);
        assertClean(h);
        assert(
          h.lines.join("\n").includes("First generation wedged after"),
          "the abandon must be logged",
        );
      },
    ),
});

Deno.test({
  name: "evolveRL: a later generation that never settles ends at the hard cap",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "later generation wedged",
      (call, _neat, original, h, registerStuck) => {
        if (call === 1) return original(undefined as never);
        registerStuck();
        h.state.nowMS = computeHardDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        return new Promise<never>(() => {});
      },
      (result, h) => {
        assertEquals(result.terminationReason, "hard-deadline");
        assertEquals(result.generation, 1);
        assertEquals(h.state.evolveCalls, 2);
        assertClean(h);
        assert(
          h.lines.join("\n").includes("Hard deadline"),
          "the abandon must be logged",
        );
      },
    ),
});

Deno.test({
  name: "evolveRL: the top-of-loop hard cap stops before a second generation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "top-of-loop cap",
      async (call, _neat, original, h, registerStuck) => {
        if (call > 1) {
          throw new Error("a second generation must never start");
        }
        const r = await original(undefined as never);
        registerStuck();
        h.state.nowMS = computeHardDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        return r;
      },
      (result, h) => {
        assertEquals(result.terminationReason, "hard-deadline");
        assertEquals(result.generation, 1);
        assertEquals(h.state.evolveCalls, 1);
        assertClean(h);
      },
    ),
});

Deno.test({
  name:
    "evolveRL: a first generation slower than the hard cap is not abandoned at the hard cap",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "slow first generation",
      async (call, _neat, original, h) => {
        if (call > 1) {
          throw new Error("a second generation must never start");
        }
        // Strictly between the hard deadline and the first-generation bound.
        h.state.nowMS = computeHardDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        // Settle only after the watchdog has polled the clock at this time a
        // few times, so a first generation capped at the hard deadline would
        // already have been abandoned.
        const POLLS_BEFORE_SETTLING = 3;
        const polled = new Promise<void>((resolve) => {
          let polls = 0;
          h.state.onNow = () => {
            if (++polls >= POLLS_BEFORE_SETTLING) {
              h.state.onNow = undefined;
              resolve();
            }
          };
        });
        const r = await original(undefined as never);
        await polled;
        return r;
      },
      (result, h) => {
        assertEquals(result.terminationReason, "hard-deadline");
        assertEquals(result.generation, 1);
        assertEquals(h.state.evolveCalls, 1);
        assert(
          !h.lines.join("\n").includes("First generation wedged after"),
          "a first generation that settled must not be logged as wedged",
        );
      },
    ),
});

Deno.test({
  name:
    "evolveRL: an over-run before the hard cap stops new generations as an over-run",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "over-run",
      async (call, _neat, original, h) => {
        if (call > 1) {
          throw new Error("no generation may start after the over-run");
        }
        const r = await original(undefined as never);
        // Past timeoutMinutes × factor 1, still before the hard cap.
        h.state.nowMS = START_MS + TIMEOUT_MINUTES * 60_000 + 30_000;
        return r;
      },
      (result, h) => {
        assertEquals(result.terminationReason, "overrun");
        assertEquals(result.generation, 1);
        assertEquals(h.state.evolveCalls, 1);
        const joined = h.lines.join("\n");
        assert(
          joined.includes("Training over-run"),
          "the over-run self-termination must be logged",
        );
        assert(
          !joined.includes("Hard deadline"),
          "the hard cap must not be what ends the run",
        );
      },
      { deps: { overrunEnforcementFactor: 1 } },
    ),
});

Deno.test({
  name:
    "evolveRL: a completed run before the hard cap still runs a requested additional generation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "completed before the cap",
      async (call, neat, original) => {
        const r = await original(undefined as never);
        // As evolve() does when it folds in trained creatures: ask for one
        // more generation before the run may finish.
        if (call === 1) neat.additionalGenerationCount = 1;
        return r;
      },
      (result, h) => {
        assertEquals(result.terminationReason, undefined);
        assertEquals(result.generation, 2);
        assertEquals(h.state.evolveCalls, 2);
      },
      { iterations: 1 },
    ),
});

Deno.test({
  name:
    "evolveRL: an abandoned generation's statistics do not reach the final milestone",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "abandoned generation statistics",
      async (call, _neat, original, h, registerStuck) => {
        const r = await original(undefined as never);
        if (call < 4) return r;
        // Generation 4 scores its episodes, then never settles. Generation 3
        // is the last one kept and is not a scheduled milestone (1, 2, 5, …),
        // so the run ends with a synthetic milestone for it.
        registerStuck();
        h.state.nowMS = computeHardDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        return new Promise<never>(() => {});
      },
      (result, h) => {
        assertEquals(result.terminationReason, "hard-deadline");
        assertEquals(result.generation, 3);
        assertEquals(h.state.evolveCalls, 4);
        assertEquals(
          result.milestones?.map((m) => m.generation),
          [1, 2, 3],
        );
        // Every scheduled milestone saw one single-step episode per creature,
        // so its mean is 1. The final one must not be built from the episodes
        // generation 4 scored before it was abandoned.
        assertEquals(result.milestones?.[0].meanEpisodeSteps, 1);
        assertEquals(result.milestones?.[2].meanEpisodeSteps, 0);
      },
      { statistics: true },
    ),
});
