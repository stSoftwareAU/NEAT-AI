/**
 * Event-loop watchdog primitive — Issue #4066, part of #4060; liveness
 * measurement — Issue #4096.
 *
 * Every in-process training bound (`awaitWithinHardDeadline` in
 * `HardDeadlineRace.ts` is the reference) polls its deadline with `setInterval`
 * on the same event loop as the work it bounds. That poll only fires while the
 * loop is free. A main thread blocked in a synchronous loop, or a V8 heap that
 * is thrashing in garbage collection, silences the bound at exactly the moment
 * it is needed — the #4060 failure mode.
 *
 * `armEventLoopWatchdog` therefore runs its deadline in a Deno Worker, which has
 * its own event loop and its own timer. At the deadline the Worker writes the
 * breach line to stderr and sends `SIGKILL` to the whole process, so a wedged
 * run ends with exit status 137 instead of outliving its own cap.
 *
 * Why `SIGKILL` and not the usual alternatives:
 *
 * - `SIGTERM` is swallowed when the main thread has a `SIGTERM` listener, and
 *   `evolveDir`, `evolveEnv` and `evolveRL` register one in
 *   `src/creature/CreatureTraining.ts`.
 * - `Deno.exit` called from a Worker ends only that Worker, not the process.
 *
 * `SIGKILL` skips in-process cleanup. That is acceptable for a last-resort
 * bound: by the time it fires, the cooperative bounds have already failed, and
 * the run's completed work is what has been persisted so far.
 *
 * Liveness. The main thread also bumps a heartbeat in shared memory once at arm
 * and then every `heartbeatIntervalMS` on a timer. The breach line carries
 * `lastHeartbeatAgeMs`, the age of the newest heartbeat at breach, plus the
 * phase the run last declared with `setPhase`. It also carries
 * `lastHeartbeatHeapUsedMB`, the V8 heap used when the main thread last ticked,
 * and `heapLimitMB`, the isolate's V8 heap limit, so a blocked loop near the
 * limit (garbage collection thrash) can be told from one with headroom
 * (synchronous work). The age is roughly the time
 * since arm or since the last tick. An age far above `heartbeatIntervalMS`
 * means the main loop never got to tick, so it was blocked. An age at or below
 * about one interval means the loop was still turning and the run was simply
 * over budget. The main thread also logs a non-fatal stall line when a tick is
 * late by `stallReportMS` or more, naming the phase at the last heartbeat and
 * the phase now. It uses the wall clock (`Date.now`), so a clock step can
 * produce a false report.
 *
 * The caller must `disarm()` in a `finally`. An armed Worker keeps the process
 * alive until its deadline, so a run that finishes early must release it. The
 * heartbeat timer is unreferenced, so it never keeps the process alive by
 * itself.
 *
 * `armRunWatchdog` in `src/creature/EvolveRunWatchdog.ts` arms this primitive
 * for `evolveDir`, `evolveEnv` and `evolveRL` when `timeoutMinutes` is set
 * (Issue #4067).
 *
 * @module
 */

import { getLogger } from "../utils/Logger.ts";
import { ConfigurationError } from "../errors/ConfigurationError.ts";
import { readHeapSizeLimit } from "./HeapSizeLimit.ts";

/**
 * Placeholder in `breachLine` that is replaced at breach time with the last
 * generation passed to {@link EventLoopWatchdog.setGeneration}, or `unknown` if
 * no generation has been set.
 */
export const EVENT_LOOP_WATCHDOG_GENERATION_TOKEN = "{generation}";

/**
 * Phases a run can declare with {@link EventLoopWatchdog.setPhase}. The index of
 * the phase is stored in shared memory, and the Worker maps it back to a name at
 * breach. A watchdog that never had a phase set reports `untracked`.
 */
export const EVENT_LOOP_WATCHDOG_PHASES = [
  "untracked",
  "fitness",
  "sort",
  "write-scores",
  "breeding",
  "mutation",
  "pre-warm",
  "deduplication",
  "parent-selection",
  "result-processing",
] as const;

/** A phase name from {@link EVENT_LOOP_WATCHDOG_PHASES}. */
export type EventLoopWatchdogPhase = typeof EVENT_LOOP_WATCHDOG_PHASES[number];

/**
 * Heartbeat interval used when {@link EventLoopWatchdogOptions.heartbeatIntervalMS}
 * is not given.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * Lateness of a heartbeat tick, in milliseconds, at which the main thread logs
 * a non-fatal stall line. Used when
 * {@link EventLoopWatchdogOptions.stallReportMS} is not given.
 */
export const DEFAULT_STALL_REPORT_MS = 10_000;

/** Options for {@link armEventLoopWatchdog}. */
export interface EventLoopWatchdogOptions {
  /**
   * Absolute deadline as epoch milliseconds on the real wall clock, i.e. the
   * same clock as `Date.now()`. Must be finite.
   */
  deadlineEpochMS: number;
  /**
   * Line written to stderr at breach, before the process is killed. Every
   * occurrence of {@link EVENT_LOOP_WATCHDOG_GENERATION_TOKEN} is replaced with
   * the current generation. Must be non-empty after trimming.
   */
  breachLine: string;
  /**
   * How often the main thread bumps the heartbeat, in milliseconds. Must be a
   * finite number greater than zero. Defaults to
   * {@link DEFAULT_HEARTBEAT_INTERVAL_MS}.
   */
  heartbeatIntervalMS?: number;
  /**
   * Minimum lateness of a heartbeat tick, in milliseconds, before the main
   * thread logs a stall. Must be a finite number greater than zero. Defaults to
   * {@link DEFAULT_STALL_REPORT_MS}.
   */
  stallReportMS?: number;
}

/** Handle returned by {@link armEventLoopWatchdog}. */
export interface EventLoopWatchdog {
  /**
   * Stop the watchdog so the process can exit without a breach. Idempotent,
   * because `Worker.terminate()` and `clearInterval` are. Call it in a `finally`
   * once the bounded work is over.
   */
  disarm(): void;
  /**
   * Record the generation the run is currently on, for the breach line. Must be
   * a safe non-negative integer no greater than 2147483647.
   */
  setGeneration(generation: number): void;
  /**
   * Record the phase the run is in, for the breach line. Must be one of
   * {@link EVENT_LOOP_WATCHDOG_PHASES}.
   *
   * @throws {ConfigurationError} `INVALID_TYPE` if `phase` is not in the list.
   */
  setPhase(phase: EventLoopWatchdogPhase): void;
}

/** Stored in the shared generation slot until {@link setGeneration} is called. */
const GENERATION_UNKNOWN = -1;

/** Largest generation the shared `Int32Array` slot can hold. */
const GENERATION_MAX = 2147483647;

/** Handle used when the Worker cannot be armed: every call does nothing. */
const NOOP_HANDLE: EventLoopWatchdog = {
  disarm(): void {},
  setGeneration(): void {},
  setPhase(): void {},
};

function logUnavailable(cause: string): void {
  getLogger().error(
    `[Neat] event-loop watchdog unavailable: ${cause} — only the in-process bound applies`,
  );
}

/**
 * Decide whether a heartbeat tick is a stall, and if so return the stall line.
 * A tick is a stall when it is late by `stallReportMS` or more, where lateness
 * is the gap since the last heartbeat less `heartbeatIntervalMS`. Returns
 * `undefined` otherwise. The main-thread heartbeat timer calls this on every
 * tick, so it is the production reader of the stall line.
 */
export function describeMainLoopStall(input: {
  nowMS: number;
  lastBeatMS: number;
  heartbeatIntervalMS: number;
  stallReportMS: number;
  generation: number;
  lastBeatPhase: EventLoopWatchdogPhase;
  phaseNow: EventLoopWatchdogPhase;
}): string | undefined {
  const gapMS = input.nowMS - input.lastBeatMS;
  const lateMS = gapMS - input.heartbeatIntervalMS;
  if (lateMS < input.stallReportMS) return undefined;
  const genText = input.generation === GENERATION_UNKNOWN
    ? "unknown"
    : String(input.generation);
  return `[Neat] main loop stalled for ${gapMS}ms (heartbeat every ${input.heartbeatIntervalMS}ms) at generation ${genText}; phase at last heartbeat: ${input.lastBeatPhase}, phase now: ${input.phaseNow}`;
}

/**
 * Build the main-thread heartbeat tick. The returned function stores the
 * heartbeat and, when the tick is a stall per {@link describeMainLoopStall},
 * warns first. The arm-time heartbeat is taken here, without the check, so
 * arming never reports. Everything it reads or writes is injected so the
 * wiring can be exercised with a fixed clock.
 */
export function createHeartbeatBeat(deps: {
  now: () => number;
  heartbeatIntervalMS: number;
  stallReportMS: number;
  readGeneration: () => number;
  readPhase: () => EventLoopWatchdogPhase;
  storeHeartbeat: (epochMS: number) => void;
  warn: (line: string) => void;
}): () => void {
  let lastBeatMS = deps.now();
  let lastBeatPhase = deps.readPhase();
  deps.storeHeartbeat(lastBeatMS);
  return (): void => {
    const nowMS = deps.now();
    const phaseNow = deps.readPhase();
    const stall = describeMainLoopStall({
      nowMS,
      lastBeatMS,
      heartbeatIntervalMS: deps.heartbeatIntervalMS,
      stallReportMS: deps.stallReportMS,
      generation: deps.readGeneration(),
      lastBeatPhase,
      phaseNow,
    });
    if (stall !== undefined) deps.warn(stall);
    deps.storeHeartbeat(nowMS);
    lastBeatMS = nowMS;
    lastBeatPhase = phaseNow;
  };
}

/**
 * Arm an off-main-thread deadline that SIGKILLs the process at breach.
 *
 * The options are validated before anything is spawned. If the Worker cannot
 * be created, the failure is logged once and a no-op handle is returned, so the
 * in-process bound still applies. A Worker that fails to load (for example
 * without read permission) reports asynchronously; that path is handled by the
 * `error` listener below.
 *
 * @throws {ConfigurationError} `NOT_FINITE` if `deadlineEpochMS`,
 *   `heartbeatIntervalMS` or `stallReportMS` is not finite; `OUT_OF_RANGE` if
 *   `heartbeatIntervalMS` or `stallReportMS` is not greater than zero;
 *   `INVALID_TYPE` if `breachLine` is empty after trimming.
 */
export function armEventLoopWatchdog(
  options: EventLoopWatchdogOptions,
): EventLoopWatchdog {
  if (!Number.isFinite(options.deadlineEpochMS)) {
    throw new ConfigurationError(
      `deadlineEpochMS must be a finite epoch-ms number, got ${options.deadlineEpochMS}`,
      "NOT_FINITE",
    );
  }
  if (
    typeof options.breachLine !== "string" ||
    options.breachLine.trim().length === 0
  ) {
    throw new ConfigurationError(
      "breachLine must be a non-empty string",
      "INVALID_TYPE",
    );
  }
  const heartbeatIntervalMS = options.heartbeatIntervalMS ??
    DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (!Number.isFinite(heartbeatIntervalMS)) {
    throw new ConfigurationError(
      `heartbeatIntervalMS must be a finite number of milliseconds, got ${heartbeatIntervalMS}`,
      "NOT_FINITE",
    );
  }
  if (heartbeatIntervalMS <= 0) {
    throw new ConfigurationError(
      `heartbeatIntervalMS must be greater than 0, got ${heartbeatIntervalMS}`,
      "OUT_OF_RANGE",
    );
  }
  const stallReportMS = options.stallReportMS ?? DEFAULT_STALL_REPORT_MS;
  if (!Number.isFinite(stallReportMS)) {
    throw new ConfigurationError(
      `stallReportMS must be a finite number of milliseconds, got ${stallReportMS}`,
      "NOT_FINITE",
    );
  }
  if (stallReportMS <= 0) {
    throw new ConfigurationError(
      `stallReportMS must be greater than 0, got ${stallReportMS}`,
      "OUT_OF_RANGE",
    );
  }

  // The generation and the phase live in shared memory rather than in a
  // message. Slot 0 is the generation and slot 1 is the phase index, which is
  // 0 ("untracked") until setPhase is called. The Worker reads both at breach
  // time, so it sees the latest values even when the main thread blocks straight
  // after writing them, with no dependence on the order in which messages are
  // delivered.
  const generationBuffer = new SharedArrayBuffer(8);
  const generation = new Int32Array(generationBuffer);
  Atomics.store(generation, 0, GENERATION_UNKNOWN);

  // The heartbeat is epoch milliseconds in one 64-bit slot. The main thread
  // bumps it; the Worker reads it at breach to measure how long the main loop
  // has gone without a tick.
  const heartbeatBuffer = new SharedArrayBuffer(8);
  const heartbeat = new BigInt64Array(heartbeatBuffer);

  // Two 64-bit slots for the heap, in bytes: slot 0 is V8 heap used at the
  // latest heartbeat, slot 1 is the V8 heap limit, stored once here. Both must
  // be set before createHeartbeatBeat below, whose arm-time beat writes slot 0.
  const heapBuffer = new SharedArrayBuffer(16);
  const heap = new BigInt64Array(heapBuffer);
  Atomics.store(heap, 1, BigInt(Math.max(0, Math.round(readHeapSizeLimit()))));

  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./EventLoopWatchdogWorker.ts", import.meta.url),
      { type: "module", name: "neat-event-loop-watchdog" },
    );
  } catch (err) {
    logUnavailable(err instanceof Error ? err.message : String(err));
    return NOOP_HANDLE;
  }

  // The main thread also reports a stall. A tick that is late by stallReportMS
  // or more logs one line naming the phase at the last heartbeat and now. The
  // arm-time beat is stored without the check, so it never reports. Date.now is
  // the wall clock, so a clock step can produce a false report.
  const beat = createHeartbeatBeat({
    now: Date.now,
    heartbeatIntervalMS,
    stallReportMS,
    readGeneration: () => Atomics.load(generation, 0),
    readPhase: () => EVENT_LOOP_WATCHDOG_PHASES[Atomics.load(generation, 1)],
    storeHeartbeat: (ms) => {
      Atomics.store(heartbeat, 0, BigInt(ms));
      Atomics.store(
        heap,
        0,
        BigInt(Math.max(0, Math.round(Deno.memoryUsage().heapUsed))),
      );
    },
    warn: (line) => getLogger().warn(line),
  });
  const heartbeatTimer = setInterval(beat, heartbeatIntervalMS);
  // Unreferenced, so the heartbeat never keeps the process alive on its own.
  // The Worker's deadline is what holds the process until disarm.
  Deno.unrefTimer(heartbeatTimer);

  // A Worker that cannot load does not throw from `new Worker`. It reports an
  // asynchronous `error` event instead. Preventing the default stops that event
  // from crashing the main process. The Worker has already stopped by the time
  // the event arrives — it never loaded, or it raised an uncaught error — so
  // there is nothing left to terminate. The heartbeat has no reader any more,
  // so its timer is stopped too.
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    clearInterval(heartbeatTimer);
    logUnavailable(event.message);
  });

  // The arm message goes last, after the heartbeat is set up, so the main thread
  // does no more work between handing the Worker its deadline and returning the
  // handle. A caller that sets a generation straight after arm is then no more
  // exposed to the Worker's breach than it was before liveness was added.
  worker.postMessage({
    deadlineEpochMS: options.deadlineEpochMS,
    breachLine: options.breachLine,
    generationBuffer,
    heartbeatBuffer,
    heapBuffer,
    phaseNames: EVENT_LOOP_WATCHDOG_PHASES,
    heartbeatIntervalMS,
  });

  return {
    // Idempotent because `clearInterval` and `Worker.terminate()` both are.
    disarm(): void {
      clearInterval(heartbeatTimer);
      worker.terminate();
    },
    setGeneration(next: number): void {
      if (!Number.isInteger(next)) {
        throw new ConfigurationError(
          `generation must be an integer, got ${next}`,
          "NOT_INTEGER",
        );
      }
      if (next < 0 || next > GENERATION_MAX) {
        throw new ConfigurationError(
          `generation must be between 0 and ${GENERATION_MAX}, got ${next}`,
          "OUT_OF_RANGE",
        );
      }
      Atomics.store(generation, 0, next);
    },
    setPhase(phase: EventLoopWatchdogPhase): void {
      const index = EVENT_LOOP_WATCHDOG_PHASES.indexOf(phase);
      if (index < 0) {
        throw new ConfigurationError(
          `phase must be one of ${
            EVENT_LOOP_WATCHDOG_PHASES.join(", ")
          }, got ${phase}`,
          "INVALID_TYPE",
        );
      }
      Atomics.store(generation, 1, index);
    },
  };
}
