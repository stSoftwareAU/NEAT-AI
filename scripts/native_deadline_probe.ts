/**
 * Child-process driver for the native deadline integration tests (Issue #4119).
 *
 * `test/architecture/training/NativeDeadlineIntegration.ts` runs this file in a
 * fresh process per scenario, so the environment, the adapter and the native
 * library are each fixed before anything loads. It drives the real exported
 * `trainDir` (and, for `worker-productive`, the real `WorkerHandler` boundary),
 * then prints ONE JSON object on stdout as its last line. Clock reads live here
 * and nowhere under `test/` (AGENTS.md: no timing APIs in tests).
 *
 * Usage: `deno run -A scripts/native_deadline_probe.ts <scenario>`
 *
 * The caller sets the environment; this driver never sets it. It checks the
 * preconditions that make the forced adapter real and exits 2 when they do not
 * hold:
 *   - FFI scenarios need a resolvable `libneat_ai_backpropagation` and
 *     `NEAT_AI_BACKPROP_REQUIRE_FFI=1`, so the CLI fallback is refused.
 *   - CLI scenarios need no resolvable library (so the bridge spawns the CLI),
 *     and `NEAT_AI_BACKPROP_BINARY_PATH` set.
 *
 * The adapter that ran is read from the bridge's own info log
 * (`trainDir using FFI ...` / `trainDir using CLI ...`), not inferred.
 *
 * Scenarios:
 *   ffi-productive, cli-productive  8000 records, 500 identity hidden neurons,
 *                                   1 s deadline (the first epoch outlasts it).
 *   ffi-expired, cli-expired        deadline now + 1 ms (expires before useful work).
 *   legacy-ffi, legacy-cli          100 records, 3 hidden neurons, far-future
 *                                   deadline, on a legacy engine.
 *   worker-productive               the productive fixture through a real
 *                                   `WorkerHandler` (a Deno Worker).
 *   scheduler-productive            the productive fixture dispatched by the
 *                                   real `scheduleTraining` to a real
 *                                   `WorkerHandler`, and the result it hands
 *                                   to `recordTrainingComplete`.
 *
 * Exit: 0 with the JSON line; 2 for an unknown scenario or an unmet
 * precondition; 1 (stderr) for an unexpected failure.
 */

import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  isFailedTrainWorkerResponse,
  scheduleTraining,
} from "@neat/NeatScheduling.ts";
import type { Neat } from "@neat/Neat.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { TRAINING_TASK_WATCHDOG_GRACE_MS } from "@neat/PerTaskTrainingTimeout.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { findNativeBackpropLibrary } from "@architecture/training/NativeBackpropLibrary.ts";
import { type Logger, setLogger } from "@utils/Logger.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { WorkerTaskCancelledError } from "@workers/WorkerTaskCancelledError.ts";

export type Adapter = "ffi" | "cli";

export type Scenario =
  | "ffi-productive"
  | "cli-productive"
  | "ffi-expired"
  | "cli-expired"
  | "legacy-ffi"
  | "legacy-cli"
  | "worker-productive"
  | "scheduler-productive";

/** Scenario -> the adapter it must force. */
export const SCENARIO_ADAPTER: Record<Scenario, Adapter> = {
  "ffi-productive": "ffi",
  "cli-productive": "cli",
  "ffi-expired": "ffi",
  "cli-expired": "cli",
  "legacy-ffi": "ffi",
  "legacy-cli": "cli",
  "worker-productive": "ffi",
  "scheduler-productive": "ffi",
};

const PRODUCTIVE_RECORDS = 8_000;
const PRODUCTIVE_HIDDEN = 500;
const PRODUCTIVE_DEADLINE_MS = 1_000;
/**
 * `scheduleTraining` refuses a budget under `MIN_TRAINING_BUDGET_MS` (1 s), so
 * the scheduled scenario gives the task a little more than that.
 */
const SCHEDULED_DEADLINE_MS = 2_000;
/**
 * The scheduler asks for only a few epochs, so the fixture is larger than the
 * productive one to keep the first epoch longer than `SCHEDULED_DEADLINE_MS`.
 */
const SCHEDULED_RECORDS = 40_000;
const SCHEDULED_HIDDEN = 1_000;
/**
 * Expired-before-useful-work deadline. `trainDir` skips the native trainer when
 * `hardDeadlineTS` is already past (`rustTrainDirSkipReason`), and a deadline
 * one millisecond out loses that race in practice, so the TypeScript loop ran
 * instead. The expiry is therefore carried by the relative budget: the run's
 * one deadline is `min(now + budget, hardDeadlineTS)`, which is `now` here,
 * while the hard deadline stays far in the future and the native trainer is
 * still reached.
 */
const EXPIRED_BUDGET_MINUTES = 1e-9;
const EXPIRED_HARD_DEADLINE_OFFSET_MS = 600_000;
const SMALL_RECORDS = 100;
const SMALL_HIDDEN = 3;
const LEGACY_DEADLINE_MS = 600_000;

/** Fields of the JSON line the test reads. `null` means not applicable or NaN. */
interface ProbeOutput {
  scenario: Scenario;
  adapter: Adapter | "none";
  adapterLog: string | null;
  deadlineEpochMs: number | null;
  timedOut: boolean | null;
  bestMeasure: string | null;
  error: number | null;
  errorIsNaN: boolean;
  iteration: number | null;
  weightsChanged: boolean;
  weightsValid: boolean;
  settledAfterDeadlineMs: number | null;
  /** Whether the run settled within the training task watchdog grace. */
  settledWithinGrace: boolean;
  warnings: string[];
  infos: string[];
  /** Worker scenario only: whether `timedOut` crossed the worker wire. */
  timedOutOnWire?: boolean;
  /** Worker scenario only: the handler's health after the task settled. */
  healthy?: boolean;
  /** Worker scenario only: the task was cancelled rather than answered. */
  cancelled?: boolean;
  /** Worker scenario only: what the adapter field rests on. */
  adapterSource?: string;
  /** Worker scenario only: the rejection message when no response arrived. */
  failure?: string | null;
  /**
   * Worker scenario only: the scheduler would evaluate the returned creature
   * (`!isFailedTrainWorkerResponse`), rather than record a failed training.
   */
  evaluated?: boolean;
  /**
   * Scheduler scenario only: how many results `scheduleTraining` handed to
   * `recordTrainingComplete`, and whether it recorded an outcome in the
   * regression tracker (it must not for a deadline stop that measured no full
   * error: the weights are queued unscored).
   */
  queuedCount?: number;
  trackerUpdated?: boolean;
}

/** Messages the bridge and the trainer log while a scenario runs. */
export interface Recorded {
  infos: string[];
  warnings: string[];
}

export function fail(code: number, message: string): never {
  console.error(message);
  Deno.exit(code);
}

/** Route every log line into memory so stdout carries only the JSON line. */
export function installRecorder(): Recorded {
  const recorded: Recorded = { infos: [], warnings: [] };
  const recorder: Logger = {
    debug() {},
    info(...args: unknown[]) {
      recorded.infos.push(args.map((arg) => String(arg)).join(" "));
    },
    warn(...args: unknown[]) {
      recorded.warnings.push(args.map((arg) => String(arg)).join(" "));
    },
    error(...args: unknown[]) {
      recorded.warnings.push(args.map((arg) => String(arg)).join(" "));
    },
  };
  setLogger(recorder);
  return recorded;
}

/** The adapter the bridge logged, or `none` when it fell through to TypeScript. */
export function adapterFrom(
  infos: string[],
): { adapter: Adapter | "none"; log: string | null } {
  const line = infos.find((message) =>
    message.includes("trainDir using FFI") ||
    message.includes("trainDir using CLI")
  );
  if (line === undefined) return { adapter: "none", log: null };
  return { adapter: line.includes("using FFI") ? "ffi" : "cli", log: line };
}

/** Refuse to run a forced-adapter scenario whose adapter would not be the one forced. */
export function checkAdapterPrecondition(
  adapter: Adapter,
  lib: string | null = findNativeBackpropLibrary(),
  readEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): void {
  if (adapter === "ffi") {
    if (lib === null) {
      fail(
        2,
        "FFI scenario: no libneat_ai_backpropagation resolves; set NEAT_AI_BACKPROP_LIB_PATH",
      );
    }
    if (readEnv("NEAT_AI_BACKPROP_REQUIRE_FFI") !== "1") {
      fail(
        2,
        "FFI scenario: set NEAT_AI_BACKPROP_REQUIRE_FFI=1 so the CLI fallback is refused",
      );
    }
    return;
  }
  if (lib !== null) {
    fail(
      2,
      `CLI scenario: the FFI library resolves to ${lib}; the CLI would not be exercised`,
    );
  }
  if (!readEnv("NEAT_AI_BACKPROP_BINARY_PATH")) {
    fail(2, "CLI scenario: set NEAT_AI_BACKPROP_BINARY_PATH");
  }
}

/** `count` `(x, 2x)` records, `x` cycling through 0.1 .. 1.0 (as the Backprop corpus). */
export function recordsFor(count: number): DataRecordInterface[] {
  return Array.from({ length: count }, (_, i) => {
    const x = ((i % 10) + 1) * 0.1;
    return {
      input: new Float32Array([x]),
      output: new Float32Array([2 * x]),
    };
  });
}

/**
 * Wide forward-only fan-in: `input-0 -> h{i}` for every hidden neuron, then
 * `h{i} -> o1` at weight `1/hidden`, so the output equals the input. Synapses are
 * sorted by target, as neat-core requires.
 */
export function wideCreatureJSON(hidden: number): Record<string, unknown> {
  const neurons: Record<string, unknown>[] = Array.from(
    { length: hidden },
    (_, i) => ({ type: "hidden", uuid: `h${i}`, bias: 0, squash: "IDENTITY" }),
  );
  neurons.push({ type: "output", uuid: "o1", bias: 0, squash: "IDENTITY" });
  const fanIn = Array.from({ length: hidden }, (_, i) => ({
    fromUUID: "input-0",
    toUUID: `h${i}`,
    weight: 1.0,
  }));
  const fanOut = Array.from({ length: hidden }, (_, i) => ({
    fromUUID: `h${i}`,
    toUUID: "o1",
    weight: 1.0 / hidden,
  }));
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons,
    synapses: [...fanIn, ...fanOut],
  };
}

/** Identity chain `input-0 -> h0 -> .. -> h{n-1} -> o1`, weights 1. */
export function chainCreatureJSON(hidden: number): Record<string, unknown> {
  const names = Array.from({ length: hidden }, (_, i) => `h${i}`);
  const neurons: Record<string, unknown>[] = names.map((uuid) => ({
    type: "hidden",
    uuid,
    bias: 0,
    squash: "IDENTITY",
  }));
  neurons.push({ type: "output", uuid: "o1", bias: 0, squash: "IDENTITY" });
  const sources = ["input-0", ...names];
  const targets = [...names, "o1"];
  const synapses = sources.map((fromUUID, i) => ({
    fromUUID,
    toUUID: targets[i],
    weight: 1.0,
  }));
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons,
    synapses,
  };
}

function creatureFrom(json: Record<string, unknown>): Creature {
  return Creature.fromJSON(JSON.parse(JSON.stringify(json)));
}

/** Biases and weights keyed by UUID, so the comparison ignores array order. */
function parameterMap(json: CreatureExport): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of json.neurons) map.set(`bias:${n.uuid}`, n.bias);
  for (const s of json.synapses) {
    map.set(`weight:${s.fromUUID}>${s.toUUID}`, s.weight);
  }
  return map;
}

function parametersChanged(
  before: Map<string, number>,
  after: Map<string, number>,
): boolean {
  if (before.size !== after.size) return true;
  for (const [key, value] of before) {
    if (!Object.is(after.get(key), value)) return true;
  }
  return false;
}

function parametersFinite(map: Map<string, number>): boolean {
  for (const value of map.values()) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function numberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Run one `trainDir` in this process and report what the caller can observe. */
function runTrainScenario(
  scenario: Scenario,
  recorded: Recorded,
): ProbeOutput {
  const productive = scenario.endsWith("productive");
  const legacy = scenario.startsWith("legacy");
  const creature = productive
    ? creatureFrom(wideCreatureJSON(PRODUCTIVE_HIDDEN))
    : creatureFrom(chainCreatureJSON(SMALL_HIDDEN));
  const records = productive ? PRODUCTIVE_RECORDS : SMALL_RECORDS;
  const dataDir = makeDataDir(recordsFor(records), records, {
    input: creature.input,
    output: creature.output,
  });

  const expired = scenario.endsWith("expired");
  const before = parameterMap(creature.exportJSON());
  // The reported deadline: the instant the native trainer must already be past
  // (expired), or the absolute deadline it is given (productive and legacy).
  const deadlineEpochMs = expired ? Date.now() : Date.now() +
    (legacy ? LEGACY_DEADLINE_MS : PRODUCTIVE_DEADLINE_MS);
  const options: TrainOptions = expired
    ? {
      iterations: 1000,
      disableRandomSamples: true,
      trainingTimeOutMinutes: EXPIRED_BUDGET_MINUTES,
      hardDeadlineTS: Date.now() + EXPIRED_HARD_DEADLINE_OFFSET_MS,
    }
    : {
      iterations: productive ? 1000 : 3,
      disableRandomSamples: true,
      trainingTimeOutMinutes: 5,
      hardDeadlineTS: deadlineEpochMs,
    };

  let result;
  try {
    result = trainDir(creature, dataDir, options, Costs.find("MSE"));
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
  const settledAt = Date.now();

  const after = parameterMap(creature.exportJSON());
  const { adapter, log } = adapterFrom(recorded.infos);
  return {
    scenario,
    adapter,
    adapterLog: log,
    deadlineEpochMs,
    timedOut: result.timedOut ?? null,
    bestMeasure: result.bestMeasure ?? null,
    error: numberOrNull(result.error),
    errorIsNaN: Number.isNaN(result.error),
    iteration: result.iteration,
    weightsChanged: parametersChanged(before, after),
    weightsValid: parametersFinite(after),
    settledAfterDeadlineMs: settledAt - deadlineEpochMs,
    settledWithinGrace: settledAt - deadlineEpochMs <=
      TRAINING_TASK_WATCHDOG_GRACE_MS,
    warnings: recorded.warnings,
    infos: recorded.infos,
  };
}

/**
 * The productive fixture through a real `WorkerHandler` (a Deno Worker). The
 * worker runs the same `trainDir`, with the same environment as this process.
 * Logs from the worker isolate do not reach this recorder; the adapter is
 * taken from `NEAT_AI_BACKPROP_REQUIRE_FFI=1`, which refuses the CLI, so a
 * train response proves FFI ran.
 */
async function runWorkerScenario(recorded: Recorded): Promise<ProbeOutput> {
  const creature = creatureFrom(wideCreatureJSON(PRODUCTIVE_HIDDEN));
  // A finite pre-training error tag, as the scheduler always sends: a partial
  // or unmeasured native run carries it back as the result's `error`.
  addTag(creature, "error", "0.5");
  const dataDir = makeDataDir(
    recordsFor(PRODUCTIVE_RECORDS),
    PRODUCTIVE_RECORDS,
    { input: creature.input, output: creature.output },
  );
  const handler = new WorkerHandler(dataDir, "MSE", false);
  try {
    await handler.waitUntilReady();
    const before = parameterMap(creature.exportJSON());
    const deadlineEpochMs = Date.now() + PRODUCTIVE_DEADLINE_MS;
    const { response } = handler.trainTracked(
      creature,
      {
        iterations: 1000,
        disableRandomSamples: true,
        trainingTimeOutMinutes: 5,
        hardDeadlineTS: deadlineEpochMs,
      },
      "native-deadline-probe",
    );

    let data: ResponseData | undefined;
    let failure: unknown;
    try {
      data = await response;
    } catch (error) {
      failure = error;
    }
    const settledAt = Date.now();

    const train = data?.train;
    const returned = train ? parameterMap(train.creature) : undefined;
    const requireFfi = Deno.env.get("NEAT_AI_BACKPROP_REQUIRE_FFI") === "1";
    return {
      scenario: "worker-productive",
      adapter: train !== undefined && requireFfi ? "ffi" : "none",
      adapterLog: null,
      adapterSource:
        "inferred: NEAT_AI_BACKPROP_REQUIRE_FFI=1 refuses the CLI, so a train response proves FFI ran (worker isolate log not captured)",
      deadlineEpochMs,
      timedOut: train?.timedOut ?? null,
      timedOutOnWire: train !== undefined && "timedOut" in train,
      bestMeasure: train?.bestMeasure ?? null,
      evaluated: data !== undefined && !isFailedTrainWorkerResponse(data),
      error: train ? numberOrNull(train.error) : null,
      errorIsNaN: train ? Number.isNaN(train.error) : false,
      iteration: null,
      weightsChanged: returned ? parametersChanged(before, returned) : false,
      weightsValid: returned ? parametersFinite(returned) : false,
      settledAfterDeadlineMs: settledAt - deadlineEpochMs,
      settledWithinGrace: settledAt - deadlineEpochMs <=
        TRAINING_TASK_WATCHDOG_GRACE_MS,
      warnings: recorded.warnings,
      infos: recorded.infos,
      healthy: handler.isHealthy(),
      cancelled: failure instanceof WorkerTaskCancelledError,
      failure: failure === undefined
        ? null
        : failure instanceof Error
        ? failure.message
        : String(failure),
    };
  } finally {
    handler.terminate();
    await Deno.remove(dataDir, { recursive: true });
  }
}

/**
 * Dispatch the productive fixture with the real `scheduleTraining` to a real
 * `WorkerHandler` and report what it hands to `recordTrainingComplete` (Issue
 * #4119). Nothing is stubbed on the path from the scheduler to the native
 * engine; only the `Neat` bookkeeping around it is a minimal double.
 */
async function runSchedulerScenario(recorded: Recorded): Promise<ProbeOutput> {
  const creature = creatureFrom(wideCreatureJSON(SCHEDULED_HIDDEN));
  addTag(creature, "error", "0.5");
  creature.score = -0.5;
  const dataDir = makeDataDir(
    recordsFor(SCHEDULED_RECORDS),
    SCHEDULED_RECORDS,
    { input: creature.input, output: creature.output },
  );
  const handler = new WorkerHandler(dataDir, "MSE", false);
  try {
    await handler.waitUntilReady();
    const before = parameterMap(creature.exportJSON());
    const deadlineEpochMs = Date.now() + SCHEDULED_DEADLINE_MS;

    const queued: ResponseData[] = [];
    const tracker = new TrainingRegressionTracker();
    let settledAt = 0;
    const pool = { selectWorker: () => handler, getIdleWorkers: () => [] };
    const neat = {
      config: createNeatConfig({}),
      currentGeneration: 1,
      hardDeadlineTS: deadlineEpochMs,
      abandonEpoch: 0,
      trainingInProgress: new Map(),
      trainingDeadlines: new Map(),
      trainingTasks: new Map(),
      alreadyScheduledMap: new Map<string, number>(),
      trainingRegressionTracker: tracker,
      heavyWorkerPool: pool,
      fastWorkerPool: pool,
      isRunAbandonedSince: () => false,
      recordTrainingComplete: (_u: string, _e: number, r: ResponseData) => {
        settledAt = Date.now();
        queued.push(r);
        return true;
      },
    } as unknown as Neat;

    scheduleTraining(neat, creature, 5);
    await Promise.all(neat.trainingInProgress.values());

    const data = queued[0];
    const train = data?.train;
    const returned = train ? parameterMap(train.creature) : undefined;
    return {
      scenario: "scheduler-productive",
      adapter: train !== undefined &&
          Deno.env.get("NEAT_AI_BACKPROP_REQUIRE_FFI") === "1"
        ? "ffi"
        : "none",
      adapterLog: null,
      adapterSource:
        "inferred: NEAT_AI_BACKPROP_REQUIRE_FFI=1 refuses the CLI, so a train response proves FFI ran (worker isolate log not captured)",
      deadlineEpochMs,
      timedOut: train?.timedOut ?? null,
      timedOutOnWire: train !== undefined && "timedOut" in train,
      bestMeasure: train?.bestMeasure ?? null,
      evaluated: data !== undefined && !isFailedTrainWorkerResponse(data),
      queuedCount: queued.length,
      trackerUpdated: tracker.totalRegressions + tracker.totalImprovements +
          tracker.totalNoChange > 0,
      error: train ? numberOrNull(train.error) : null,
      errorIsNaN: train ? Number.isNaN(train.error) : false,
      iteration: null,
      weightsChanged: returned ? parametersChanged(before, returned) : false,
      weightsValid: returned ? parametersFinite(returned) : false,
      settledAfterDeadlineMs: settledAt === 0
        ? null
        : settledAt - deadlineEpochMs,
      settledWithinGrace: settledAt !== 0 &&
        settledAt - deadlineEpochMs <= TRAINING_TASK_WATCHDOG_GRACE_MS,
      warnings: recorded.warnings,
      infos: recorded.infos,
      healthy: handler.isHealthy(),
      cancelled: data?.error instanceof WorkerTaskCancelledError,
      failure: data?.error === undefined ? null : String(data.error),
    };
  } finally {
    handler.terminate();
    await Deno.remove(dataDir, { recursive: true });
  }
}

async function main(): Promise<void> {
  const scenario = Deno.args[0] as Scenario | undefined;
  if (scenario === undefined || !(scenario in SCENARIO_ADAPTER)) {
    fail(
      2,
      `usage: deno run -A scripts/native_deadline_probe.ts <${
        Object.keys(SCENARIO_ADAPTER).join("|")
      }>`,
    );
  }
  checkAdapterPrecondition(SCENARIO_ADAPTER[scenario]);
  const recorded = installRecorder();

  const output = scenario === "worker-productive"
    ? await runWorkerScenario(recorded)
    : scenario === "scheduler-productive"
    ? await runSchedulerScenario(recorded)
    : runTrainScenario(scenario, recorded);
  console.log(JSON.stringify(output));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    Deno.exit(1);
  }
}
