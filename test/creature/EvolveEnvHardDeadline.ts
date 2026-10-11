import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveEnv } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  computeFirstGenerationDeadlineTS,
  computeHardDeadlineTS,
} from "@neat/HardDeadline.ts";
import type { TrainingTaskHandle } from "@neat/TrainingTaskHandle.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4056: `evolveEnv` must bound `neat.evolve()` by the same deadlines as
 * `evolveDir` (Issue #4053 / GRQ #4470). A generation that never settles ends
 * the run at its own bound instead of hanging, driven by an injected clock so
 * the test makes no elapsed-time assertions.
 */

/** Single-tick adapter that can never reach `targetError`. */
function buildAdapter(): LegacyEpisodeAdapter<null, number> {
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
      () => reject(new Error(`${label}: evolveEnv did not return`)),
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
    evolveCalls: number;
    captured?: Neat;
    cancelCalls: Array<{ taskID: number; reason: string }>;
    quarantineCalls: number;
    /** Number of times the injected clock has been read. */
    nowCalls: number;
    /** One-shot hook: fires after `remaining` further clock reads. */
    afterNowReads?: { remaining: number; fire: () => void };
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
    nowCalls: 0,
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
        state.nowCalls++;
        const hook = state.afterNowReads;
        if (hook && --hook.remaining <= 0) {
          state.afterNowReads = undefined;
          hook.fire();
        }
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
    result: Awaited<ReturnType<typeof evolveEnv>>,
    h: Harness,
  ) => void,
) {
  await initWasmForTests();
  const h = await makeHarness(behave);
  const creature = new Creature(1, 1);
  const priorLogger = getLogger();
  try {
    const result = await withRealTimeGuard(
      evolveEnv(creature, buildAdapter(), {
        populationSize: 6,
        iterations: 500,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore: h.creatureStore,
        logger: h.logger,
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
  name: "evolveEnv: a first generation that never settles ends at its bound",
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
  name: "evolveEnv: a later generation that never settles ends at the hard cap",
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
  name: "evolveEnv: the top-of-loop hard cap stops before a second generation",
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
    "evolveEnv: a first generation slower than the hard cap is not abandoned at the hard cap",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    run(
      "slow first generation",
      (_call, _neat, original, h) => {
        // Strictly between the hard deadline and the first-generation bound.
        h.state.nowMS = computeHardDeadlineTS(START_MS, TIMEOUT_MINUTES)! +
          60_000;
        // While this promise is pending the loop is suspended, so every clock
        // read is the watchdog's. Settle only after it has polled twice at the
        // in-between time: a gen-1 cap of the hard deadline would abandon here.
        return new Promise((resolve, reject) => {
          h.state.afterNowReads = {
            remaining: 2,
            fire: () => original(undefined as never).then(resolve, reject),
          };
        });
      },
      (result, h) => {
        assertEquals(result.terminationReason, "hard-deadline");
        assertEquals(result.generation, 1);
        assertEquals(h.state.evolveCalls, 1);
        assert(
          !h.lines.join("\n").includes("First generation wedged after"),
          "generation 1 completed, so it must not be abandoned",
        );
      },
    ),
});
