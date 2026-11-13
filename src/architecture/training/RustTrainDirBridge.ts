/**
 * Drive eligible `trainDir` through sibling `neat_ai_backpropagation`
 * (Issues #3741, #3765, #4119).
 *
 * Prefers in-process Deno FFI (`libneat_ai_backpropagation`, Backpropagation
 * #84) when the cdylib resolves. Falls back to spawning the CLI binary when
 * the library is absent. `./quality.sh --next` requires the FFI library so
 * that path is exercised; set `NEAT_AI_BACKPROP_REQUIRE_FFI=1` to refuse the
 * CLI fallback in other environments.
 *
 * Deadline (Issue #4119): the run's one absolute timeout, `setup.timeoutTS`,
 * goes to the trainer as `deadlineEpochMs` / `--deadline-epoch-ms` only when
 * the backend advertises the deadline capability (probed per backend). A
 * capable trainer's response is the whole summary: the FFI response, or
 * `result.json` for the CLI. A timed-out run returns on the normal result
 * path. A legacy backend never receives the deadline, and a run with a
 * deadline on one logs a warning once per backend.
 *
 * Backend report (Issue #4146): each native train writes one
 * `[training-backend]` line before the blocking call (see
 * `TrainDirBackendReport.ts`). The once-per-backend `[NEAT-AI] trainDir using
 * ...` lines and the legacy-deadline warning go through the same reporter, so a
 * pooled worker relays them to the parent's logger.
 *
 * Options that are not backpropagation skip Rust (predictive coding,
 * cross-validation, custom costs, dropout, fuzzing, quantisation, Muon,
 * recurrent / `feedbackLoop`). `trainingSampleRate` maps to `maxRecords`
 * (seeded random sample unless `disableRandomSamples`). `traceStore` is
 * forwarded to the ABI / `--trace-store`.
 *
 * Default on for eligible `trainDir` (`NEAT_AI_BACKPROP_ENABLED=0` forces the
 * TypeScript / WASM loop). When Rust is enabled there is no silent WASM
 * fallback for a request the native trainer claimed: a missing library and
 * binary is an error.
 */

import { join, resolve } from "@std/path";
import { blue } from "@std/fmt/colors";
import type { CostInterface } from "@costs/CostInterface.ts";
import { MSE } from "@costs/MSE.ts";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { getLogger } from "@utils/Logger.ts";
import { pathFromModuleUrl } from "@utils/ModuleSiblingPath.ts";
import { getTag } from "@stsoftware/tags/mod";
import { TRAINING_TASK_WATCHDOG_GRACE_MS } from "@neat/PerTaskTrainingTimeout.ts";
import { finaliseTraining } from "@architecture/training/TrainingTeardown.ts";
import type { TrainingSetupState } from "@architecture/training/TrainingSetup.ts";
import type { TrainingLoopResult } from "@architecture/training/TrainingLoop.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import { readDatasetDirEntriesSync } from "@architecture/DatasetIO.ts";
import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  isNativeBackpropAvailable,
  type NativeBackpropDeadlineCapability,
  nativeBackpropDeadlineCapability,
  type NativeBackpropMeasure,
  nativeBackpropTrain,
  nativeBackpropTrainAsync,
  type NativeBackpropTrainRequest,
  type NativeBackpropTrainResponse,
  parseNativeBackpropCapabilities,
  parseNativeBackpropTrainResponse,
} from "@architecture/training/NativeBackpropLibrary.ts";
import {
  reportTrainDirBackend,
  reportTrainDirMessage,
  reportTrainDirPhase,
} from "@architecture/training/TrainDirBackendReport.ts";

/**
 * What a deadline-capable trainer reported beyond the MSE figures (Issue
 * #4119). Legacy summaries leave it unset.
 */
interface NativeRunDetail {
  bestMeasure: NativeBackpropMeasure;
  /** Phase the run stopped in; `undefined` when it did not time out. */
  phase: string | undefined;
  weightsChanged: boolean;
}

/** Derived from `journal.jsonl` epoch lines (`TrainEpochRecord`). */
interface TrainSummary {
  baselineMse: number;
  bestMse: number;
  acceptedEpochs: number;
  completedEpochs: number;
  timedOut: boolean;
  native?: NativeRunDetail;
}

interface TrainJournalLine {
  kind?: string;
  epoch?: number;
  beforeMse?: number;
  afterMse?: number;
  accepted?: boolean;
}

function summariseTrainJournal(journalPath: string): TrainSummary {
  const lines = Deno.readTextFileSync(journalPath).split("\n");
  let baselineMse = Number.NaN;
  let bestMse = Number.POSITIVE_INFINITY;
  let acceptedEpochs = 0;
  let completedEpochs = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const rec = JSON.parse(line) as TrainJournalLine;
    if (rec.kind !== "epoch") continue;
    completedEpochs = Math.max(completedEpochs, rec.epoch ?? 0);
    if (!Number.isFinite(baselineMse) && Number.isFinite(rec.beforeMse)) {
      baselineMse = rec.beforeMse as number;
    }
    if (rec.accepted === true && Number.isFinite(rec.afterMse)) {
      acceptedEpochs++;
      bestMse = Math.min(bestMse, rec.afterMse as number);
    }
  }
  if (!Number.isFinite(bestMse)) {
    bestMse = baselineMse;
  }
  return {
    baselineMse,
    bestMse,
    acceptedEpochs,
    completedEpochs,
    timedOut: false,
  };
}

export interface RustTrainDirSearchOptions {
  overridePath?: string;
  cwd?: string;
  siblingPath?: string;
}

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function envFlagOn(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function rustTrainDirFileName(): string {
  return Deno.build.os === "windows"
    ? "neat_ai_backpropagation.exe"
    : "neat_ai_backpropagation";
}

function resolveBinaryCandidate(candidate: string): string | null {
  try {
    const stat = Deno.statSync(candidate);
    if (stat.isFile) return candidate;
    if (stat.isDirectory) {
      const nested = join(candidate, rustTrainDirFileName());
      if (Deno.statSync(nested).isFile) return nested;
    }
  } catch {
    // Candidate path is not viable.
  }
  return null;
}

/** Sibling-crate binary beside a local checkout; null under JSR HTTPS loads. */
function siblingReleaseBinary(): string | null {
  return pathFromModuleUrl(
    "../../../../NEAT-AI-Backpropagation/target/release/" +
      rustTrainDirFileName(),
  );
}

/**
 * Resolve `neat_ai_backpropagation` from explicit search inputs.
 */
export function findRustTrainDirBinaryFromOptions(
  options: RustTrainDirSearchOptions,
): string | null {
  const overridePath = options.overridePath?.trim();
  if (overridePath) {
    const resolved = resolveBinaryCandidate(overridePath);
    if (resolved) return resolved;
  }

  const cwd = options.cwd ?? Deno.cwd();
  const localTarget = resolveBinaryCandidate(
    join(cwd, "target", "release", rustTrainDirFileName()),
  );
  if (localTarget) return localTarget;

  const sibling = options.siblingPath ?? siblingReleaseBinary();
  if (sibling) {
    const siblingTarget = resolveBinaryCandidate(sibling);
    if (siblingTarget) return siblingTarget;
  }

  const cwdSibling = resolveBinaryCandidate(
    join(
      cwd,
      "..",
      "NEAT-AI-Backpropagation",
      "target",
      "release",
      rustTrainDirFileName(),
    ),
  );
  if (cwdSibling) return cwdSibling;

  return null;
}

/**
 * Resolve `neat_ai_backpropagation` from the environment and well-known
 * locations.
 */
export function findRustTrainDirBinary(): string | null {
  return findRustTrainDirBinaryFromOptions({
    overridePath: readEnvString("NEAT_AI_BACKPROP_BINARY_PATH"),
  });
}

function toCliStrategy(
  strategy: TrainingSetupState["backPropConfig"]["learningRateStrategy"],
): string {
  return strategy === "warm_restart" ? "warm-restart" : strategy;
}

function toAbiStrategy(
  strategy: TrainingSetupState["backPropConfig"]["learningRateStrategy"],
): NativeBackpropTrainRequest["learningRateStrategy"] {
  return strategy === "warm_restart" ? "warmRestart" : strategy;
}

/**
 * Parse `NEAT_AI_BACKPROP_ENABLED`. Default is on: unset and unrecognised
 * values (e.g. `on`, `enabled`) stay enabled. Only an explicit off
 * (`0` / `false` / `no` / `off`) forces the TypeScript / WASM loop.
 */
export function parseRustTrainDirEnabledFlag(
  raw: string | undefined,
): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

let testEnabledOverride: boolean | undefined;
let loggedTrainDirBackend: string | undefined;
let legacyWrapperDepth = 0;

/** Isolate-local enable override for tests (do not mutate process env). */
export function __setRustTrainDirEnabledForTests(
  enabled: boolean | undefined,
): void {
  testEnabledOverride = enabled;
}

/**
 * True when `trainDir` should use the Rust trainer for eligible requests.
 *
 * Default is on. Set `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript /
 * WASM loop. `./quality.sh` without `--next` sets that so the WASM path
 * stays covered; `./quality.sh --next` sets `=1` and requires the FFI
 * library.
 */
export function isRustTrainDirEnabled(): boolean {
  if (testEnabledOverride !== undefined) return testEnabledOverride;
  return parseRustTrainDirEnabledFlag(
    readEnvString("NEAT_AI_BACKPROP_ENABLED"),
  );
}

/**
 * When true, refuse the CLI spawn fallback and require the cdylib
 * (`NEAT_AI_BACKPROP_REQUIRE_FFI=1`, set by `./quality.sh --next`).
 */
export function isRustTrainDirFfiRequired(): boolean {
  return envFlagOn(readEnvString("NEAT_AI_BACKPROP_REQUIRE_FFI"));
}

function stepScale(): number {
  const raw = readEnvString("NEAT_AI_BACKPROP_STEP_SCALE");
  if (raw === undefined) return 0.01;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : 0.01;
}

/**
 * Seed for sparse selection and record sampling. Override with
 * `NEAT_AI_BACKPROP_SEED`.
 */
function resolveTrainSeed(disableRandomSamples: boolean): number {
  const raw = readEnvString("NEAT_AI_BACKPROP_SEED");
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  if (disableRandomSamples) return 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

/** Count little-endian f32 records in a `trainDir` dataset. */
function countDatasetRecords(
  dataDir: string,
  bytesPerRecord: number,
): number {
  if (bytesPerRecord <= 0) return 0;
  let total = 0;
  for (const entry of readDatasetDirEntriesSync(dataDir)) {
    if (!entry.isFile || !entry.name.endsWith(".bin")) continue;
    const size = Deno.statSync(join(dataDir, entry.name)).size;
    total += Math.floor(size / bytesPerRecord);
  }
  return total;
}

/**
 * Run the TypeScript `trainDir` wrappers (and allow WASM
 * `propagateTopological` inside them) for options the old backprop
 * engine never honoured.
 */
export function runLegacyTrainDirWrappers<T>(fn: () => T): T {
  legacyWrapperDepth++;
  try {
    return fn();
  } finally {
    legacyWrapperDepth--;
  }
}

/** True while {@link runLegacyTrainDirWrappers} is on the stack. */
export function isLegacyTrainDirWrapperActive(): boolean {
  return legacyWrapperDepth > 0;
}

/**
 * Options that are not backpropagation (or that we do not want the
 * Rust trainer to support). When set, do not call Rust — keep the
 * TypeScript wrappers.
 */
export function rustTrainDirSkipReason(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): string | undefined {
  if (
    setup.hardDeadlineTS !== undefined &&
    setup.hardDeadlineTS > 0 &&
    setup.hardDeadlineTS <= Date.now()
  ) {
    return "hardDeadlineTS has already expired";
  }
  if (options.predictiveCoding?.enabled) {
    return "predictive coding is not backpropagation";
  }
  if (cost.getName() !== MSE.NAME) {
    return `cost ${cost.getName()} is not used by WASM backprop`;
  }
  if (setup.iterationConfig.dropoutRate > 0) {
    return "dropout is not backpropagation";
  }
  if (setup.iterationConfig.gradientOrthogonalisation === "muon") {
    return "Muon orthogonalisation is not backpropagation";
  }
  if (creature.forwardOnly !== true) {
    return "recurrent topology is not trained by backpropagation";
  }
  if (options.feedbackLoop === true) {
    return "feedbackLoop is not backpropagation";
  }
  return undefined;
}

function rustBackendAvailable(): boolean {
  if (isNativeBackpropAvailable()) return true;
  if (isRustTrainDirFfiRequired()) return false;
  return findRustTrainDirBinary() !== null;
}

/**
 * Why a request the old WASM backprop *did* handle cannot go to Rust,
 * or `undefined` when it can (or when it should skip Rust instead).
 */
export function rustTrainDirRefusalReason(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): string | undefined {
  if (rustTrainDirSkipReason(creature, options, cost, setup) !== undefined) {
    return undefined;
  }
  if (isRustTrainDirFfiRequired() && !isNativeBackpropAvailable()) {
    return "libneat_ai_backpropagation was not found (FFI required)";
  }
  if (!rustBackendAvailable()) {
    return "neat_ai_backpropagation library/binary was not found";
  }
  return undefined;
}

/**
 * True when this `trainDir` request is one the Rust trainer can honour.
 */
export function canUseRustTrainDir(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
  enabled: boolean = isRustTrainDirEnabled(),
): boolean {
  return enabled &&
    rustTrainDirSkipReason(creature, options, cost, setup) === undefined &&
    rustTrainDirRefusalReason(creature, options, cost, setup) === undefined;
}

interface SpawnedTrain {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

function decodeSpawned(
  output: Deno.CommandOutput,
): SpawnedTrain {
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function trainCommand(binary: string, args: string[]): Deno.Command {
  return new Deno.Command(binary, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
}

function spawnTrain(binary: string, args: string[]): SpawnedTrain {
  return decodeSpawned(trainCommand(binary, args).outputSync());
}

/** Awaits the child so a terminated worker is not stuck in a blocking call (Issue #4126). */
async function spawnTrainAsync(
  binary: string,
  args: string[],
): Promise<SpawnedTrain> {
  return decodeSpawned(await trainCommand(binary, args).output());
}

function buildTrainRequestFields(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  outputDir: string,
): {
  epochs: number;
  maxRecords: number | undefined;
  seed: number;
  disableRandomSamples: boolean;
  learningRate: number;
  learningRateStrategy:
    TrainingSetupState["backPropConfig"]["learningRateStrategy"];
  learningRateDecay: number;
  normaliseGradients: boolean;
  maximumBiasAdjustmentScale: number;
  maximumWeightAdjustmentScale: number;
  stepScale: number;
  traceStore: string | undefined;
  creatureJson: string;
  trainingData: string;
  outputDir: string;
} {
  const cfg = setup.iterationConfig;
  let maxRecords: number | undefined;
  if (setup.trainingSampleRate < 1) {
    const total = countDatasetRecords(dataDir, setup.BYTES_PER_RECORD);
    maxRecords = Math.max(1, Math.ceil(total * setup.trainingSampleRate));
  }
  const traceStore = options.traceStore?.trim() || undefined;
  return {
    epochs: setup.iterations,
    maxRecords,
    seed: resolveTrainSeed(cfg.disableRandomSamples),
    disableRandomSamples: cfg.disableRandomSamples === true,
    learningRate: cfg.learningRate,
    learningRateStrategy: cfg.learningRateStrategy,
    learningRateDecay: cfg.learningRateDecay,
    normaliseGradients: cfg.normaliseGradients,
    maximumBiasAdjustmentScale: cfg.maximumBiasAdjustmentScale,
    maximumWeightAdjustmentScale: cfg.maximumWeightAdjustmentScale,
    stepScale: stepScale(),
    traceStore,
    creatureJson: JSON.stringify(creature.exportJSON()),
    trainingData: resolve(Deno.cwd(), dataDir),
    outputDir: resolve(Deno.cwd(), outputDir),
  };
}

/**
 * The creature's own pre-training error: the first finite number among the
 * `error` tag and the `untrained-error` tag. The worker dispatch
 * (`WorkerHandler.trainTracked`) strips `error` and sends the pre-training
 * error as `untrained-error` instead, so a real worker only has the latter.
 * `undefined` when neither tag holds a finite number.
 */
function preTrainingErrorTag(creature: Creature): number | undefined {
  for (const name of ["error", "untrained-error"]) {
    const tag = getTag(creature, name);
    if (tag === null) continue;
    const value = parseFloat(tag);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * True once `now` is past the task deadline plus the watchdog grace
 * (Issue #4119). A task with no deadline (`timeoutTS <= 0`) never is.
 */
export function isFinalisationWindowSpent(
  timeoutTS: number,
  now: number,
): boolean {
  return timeoutTS > 0 && now > timeoutTS + TRAINING_TASK_WATCHDOG_GRACE_MS;
}

// Isolated clock seam for deterministic finalisation-window tests.
let finalisationNow: () => number = Date.now;
export function __setFinalisationNowForTests(now?: () => number): void {
  finalisationNow = now ?? Date.now;
}

/**
 * Whole ms from the task deadline to now, for the `[training-phase]` lines
 * (Issue #4146). `undefined` when the task has no deadline.
 */
function msFromDeadlineNow(setup: TrainingSetupState): number | undefined {
  return setup.timeoutTS > 0
    ? Math.round(finalisationNow() - setup.timeoutTS)
    : undefined;
}

function packageTrainingResult(
  creature: Creature,
  setup: TrainingSetupState,
  bestJson: CreatureExport,
  summary: TrainSummary,
): TrainingResult {
  // Read before `loadFrom`, while the creature still carries its pre-training tags.
  const carriedError = preTrainingErrorTag(creature);
  creature.loadFrom(bestJson, false, "training:rustTrainDir");

  const native = summary.native;
  let bestError = summary.bestMse;
  let errorNote = "";
  if (native !== undefined && native.bestMeasure.kind === "full") {
    bestError = native.bestMeasure.mse;
  } else if (native !== undefined) {
    // No full MSE was measured. Never invent a score, and never use a partial
    // MSE: carry the creature's own pre-training error (the `error` tag, or the
    // `untrained-error` tag the worker dispatch sends instead), or NaN (the
    // scheduler treats a non-finite error as a failed training result).
    bestError = carriedError ?? Number.NaN;
    errorNote = carriedError === undefined
      ? "; error is NaN (no finite pre-training error tag or untrained-error tag)"
      : `; error carried from the pre-training error (${carriedError}, the error or untrained-error tag)`;
  }

  if (native !== undefined && summary.timedOut) {
    getLogger().info(
      `Training ${blue(setup.ID)} stopped by the native deadline (phase ${
        native.phase ?? "unknown"
      }, ${summary.completedEpochs} epoch(s), weights changed: ${native.weightsChanged}, best measure: ${native.bestMeasure.kind})${errorNote}`,
    );
  }

  const loop: TrainingLoopResult = {
    iteration: Math.max(1, summary.completedEpochs),
    bestError,
    bestCreatureJSON: creature.exportJSON(),
    bestTraceJSON: creature.traceJSON(),
    sparseConfig: setup.sparseConfig,
    timedOut: summary.timedOut,
  };

  // Issue #4119: finalisation must fit the original deadline plus the
  // watchdog grace. Finalisation asks before each optional compaction stage;
  // once a deadline-stopped native run finds that window spent, the compacted
  // copy is dropped: an explicit, logged degraded outcome that still returns
  // the trained weights, instead of compacting past the window and tripping
  // the watchdog.
  let windowSpent = false;
  const windowSpentNow = (): boolean => {
    if (windowSpent) return true;
    if (
      native === undefined || !summary.timedOut ||
      !isFinalisationWindowSpent(setup.timeoutTS, finalisationNow())
    ) return false;
    windowSpent = true;
    getLogger().warn(
      `Training ${
        blue(setup.ID)
      } native adapter finalisation passed the watchdog window (deadline + ${
        TRAINING_TASK_WATCHDOG_GRACE_MS / 1000
      } s); returning the trained weights without the compacted copy.`,
    );
    return true;
  };

  const finalised = finaliseTraining(
    creature,
    loop,
    setup.iterationConfig,
    setup.iterations,
    setup.feedbackLoop,
    setup.syntheticKeys,
    setup.ID,
    { skipCompaction: windowSpentNow },
  );

  if (
    native !== undefined && !windowSpent && summary.timedOut &&
    isFinalisationWindowSpent(setup.timeoutTS, finalisationNow())
  ) {
    getLogger().warn(
      `Training ${
        blue(setup.ID)
      } native adapter finalisation settled after the watchdog window (deadline + ${
        TRAINING_TASK_WATCHDOG_GRACE_MS / 1000
      } s); diagnostic only, the result is unchanged.`,
    );
  }

  reportTrainDirPhase(setup.ID, {
    phase: "finalised",
    timedOut: summary.timedOut,
    msFromDeadline: msFromDeadlineNow(setup),
  });
  // Legacy trainers report no outcome beyond the MSE, so their result keeps
  // the old shape.
  if (native === undefined) return finalised;

  return {
    ...finalised,
    timedOut: summary.timedOut,
    bestMeasure: native.bestMeasure.kind,
  };
}

/**
 * Summary of a deadline-capable response (Issue #4119). The response alone is
 * the source: `journal.jsonl` may be absent when no epoch completed, so it is
 * not read.
 */
function summaryFromNativeResponse(
  response: NativeBackpropTrainResponse,
): TrainSummary {
  // The parser guarantees these for a deadline-capable response; the check
  // keeps a future parser change from turning into a silent default.
  if (
    response.bestMeasure === undefined ||
    response.completedEpochs === undefined ||
    response.timedOut === undefined
  ) {
    throw new Error(
      "native trainer response is missing a deadline field (bestMeasure, completedEpochs or timedOut)",
    );
  }
  return {
    baselineMse: response.baselineMse ?? Number.NaN,
    bestMse: response.bestMse ?? Number.NaN,
    acceptedEpochs: response.acceptedEpochs,
    completedEpochs: response.completedEpochs,
    timedOut: response.timedOut,
    native: {
      bestMeasure: response.bestMeasure,
      phase: response.timeout?.phase,
      weightsChanged: response.timeout?.weightsChanged ?? false,
    },
  };
}

/** Backends already warned about the missing deadline capability (Issue #4119). */
const legacyDeadlineWarnedBackends = new Set<string>();

/**
 * Warn once per backend that a run with a deadline reaches a trainer that
 * cannot enforce it (Issue #4119). The run itself is unchanged. The warning
 * goes through the training reporter, so a worker relays it to the parent
 * (Issue #4146).
 */
function warnLegacyDeadlineOnce(backendKey: string, backend: string): void {
  if (legacyDeadlineWarnedBackends.has(backendKey)) return;
  legacyDeadlineWarnedBackends.add(backendKey);
  reportTrainDirMessage(
    "warn",
    `[NEAT-AI] trainDir backend ${backend} does not advertise the native deadline capability, ` +
      `so the per-task deadline is NOT enforced natively. The stuck-task watchdog ` +
      `(deadline + ${
        TRAINING_TASK_WATCHDOG_GRACE_MS / 1000
      } s) is the only stop for this run; ` +
      `upgrade NEAT-AI-Backpropagation (issue #214) to enforce the deadline.`,
  );
}

/** Test seam: forget which backends have already been warned about. */
export function __resetNativeDeadlineDiagnosticsForTests(): void {
  legacyDeadlineWarnedBackends.clear();
}

/** `deadlineEpochMs` for a deadline-capable trainer; absent otherwise. */
function deadlineRequestField(
  deadlineCapable: boolean,
  timeoutTS: number,
): { deadlineEpochMs?: number } {
  return deadlineCapable && timeoutTS > 0
    ? { deadlineEpochMs: Math.floor(timeoutTS) }
    : {};
}

interface FfiTrainPlan {
  request: NativeBackpropTrainRequest;
  deadlineCapable: boolean;
}

/** Build the request and write the backend report; shared by the sync and async paths. */
function prepareFfiTrain(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): FfiTrainPlan {
  const outputDir = join(workDir, "out");
  Deno.mkdirSync(outputDir);
  const fields = buildTrainRequestFields(
    creature,
    dataDir,
    options,
    setup,
    outputDir,
  );
  const deadlineCapability = nativeBackpropDeadlineCapability();
  const deadlineCapable = deadlineCapability !== undefined;
  const libraryPath = findNativeBackpropLibrary() ?? "loaded";
  const request: NativeBackpropTrainRequest = {
    creatureJson: fields.creatureJson,
    trainingData: fields.trainingData,
    outputDir: fields.outputDir,
    epochs: fields.epochs,
    maxRecords: fields.maxRecords ?? null,
    seed: fields.seed,
    disableRandomSamples: fields.disableRandomSamples,
    learningRate: fields.learningRate,
    learningRateStrategy: toAbiStrategy(fields.learningRateStrategy),
    learningRateDecay: fields.learningRateDecay,
    normaliseGradients: fields.normaliseGradients,
    maximumBiasAdjustmentScale: fields.maximumBiasAdjustmentScale,
    maximumWeightAdjustmentScale: fields.maximumWeightAdjustmentScale,
    stepScale: fields.stepScale,
    traceStore: fields.traceStore ?? null,
    ...deadlineRequestField(deadlineCapable, setup.timeoutTS),
  };

  const backendKey = `ffi:${libraryPath}`;
  if (loggedTrainDirBackend !== backendKey) {
    loggedTrainDirBackend = backendKey;
    reportTrainDirMessage(
      "info",
      `[NEAT-AI] trainDir using FFI libneat_ai_backpropagation`,
    );
  }
  if (!deadlineCapable && setup.timeoutTS > 0) {
    warnLegacyDeadlineOnce(
      backendKey,
      `libneat_ai_backpropagation at ${libraryPath}`,
    );
  }

  reportTrainDirBackend(setup.ID, {
    backend: "ffi",
    deadlineSent: request.deadlineEpochMs !== undefined,
    capability: deadlineCapability === undefined
      ? "none"
      : String(deadlineCapability.version),
  });
  return { request, deadlineCapable };
}

/** Package a native response; shared by the sync and async paths. */
function finishFfiTrain(
  creature: Creature,
  setup: TrainingSetupState,
  response: NativeBackpropTrainResponse,
  deadlineCapable: boolean,
): TrainingResult {
  reportTrainDirPhase(setup.ID, {
    phase: "native-returned",
    timedOut: response.timedOut,
    msFromDeadline: msFromDeadlineNow(setup),
  });
  const bestJson = JSON.parse(response.bestCreatureJson) as CreatureExport;
  if (deadlineCapable) {
    return packageTrainingResult(
      creature,
      setup,
      bestJson,
      summaryFromNativeResponse(response),
    );
  }
  // Legacy library: the parser guarantees numeric MSEs for a legacy response.
  const summary: TrainSummary = {
    baselineMse: response.baselineMse as number,
    bestMse: response.bestMse as number,
    acceptedEpochs: response.acceptedEpochs,
    completedEpochs: Math.max(1, response.epochs),
    timedOut: false,
  };
  // Prefer journal when present (early-stop may complete fewer epochs).
  try {
    if (Deno.statSync(response.journalPath).isFile) {
      const fromJournal = summariseTrainJournal(response.journalPath);
      summary.completedEpochs = fromJournal.completedEpochs;
      summary.acceptedEpochs = fromJournal.acceptedEpochs;
      summary.baselineMse = fromJournal.baselineMse;
      summary.bestMse = fromJournal.bestMse;
    }
  } catch {
    // Response fields are authoritative when the journal is missing.
  }
  return packageTrainingResult(creature, setup, bestJson, summary);
}

function tryFfiTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): TrainingResult {
  const plan = prepareFfiTrain(creature, dataDir, options, setup, workDir);
  const response = nativeBackpropTrain(plan.request);
  return finishFfiTrain(creature, setup, response, plan.deadlineCapable);
}

async function tryFfiTrainDirAsync(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): Promise<TrainingResult> {
  const plan = prepareFfiTrain(creature, dataDir, options, setup, workDir);
  const response = await nativeBackpropTrainAsync(plan.request);
  return finishFfiTrain(creature, setup, response, plan.deadlineCapable);
}

/** The stderr line that names a failure: the first `error` line, else the first non-empty line. */
function causeLine(stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) =>
    line.length > 0
  );
  return lines.find((line) => /error/i.test(line)) ?? lines[0] ??
    "(no stderr output)";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The deadline capability the CLI advertises (Issue #4119).
 *
 * @returns `undefined` for a legacy CLI (no `capabilities` subcommand) or one
 *          advertising an unsupported version. Any other failure throws rather
 *          than falling back silently.
 */
export function cliDeadlineCapability(
  binary: string,
): NativeBackpropDeadlineCapability | undefined {
  // SIMPLE-ON-PURPOSE: one capabilities spawn per train (a few ms beside a multi-second train); upgrade when CLI trains become sub-second.
  const probe = spawnTrain(binary, ["capabilities"]);
  if (probe.success) {
    return parseNativeBackpropCapabilities(probe.stdout).deadline;
  }
  if (probe.stderr.includes("unrecognized subcommand")) return undefined;
  throw new Error(
    `neat_ai_backpropagation capabilities failed (exit ${probe.code}): ${
      causeLine(probe.stderr)
    }`,
  );
}

/** Whether the CLI advertises the deadline capability (Issue #4119). */
export function cliDeadlineCapable(binary: string): boolean {
  return cliDeadlineCapability(binary) !== undefined;
}

/**
 * `result.json` written by a deadline-capable CLI: the same object the FFI
 * returns. A missing or malformed file throws, and the message names it.
 */
function readCliResultFile(outputDir: string): NativeBackpropTrainResponse {
  const resultPath = join(outputDir, "result.json");
  let text: string;
  try {
    text = Deno.readTextFileSync(resultPath);
  } catch (error) {
    throw new Error(
      `neat_ai_backpropagation train exited 0 but ${resultPath} could not be read: ${
        errorMessage(error)
      }`,
    );
  }
  try {
    return parseNativeBackpropTrainResponse(text, true);
  } catch (error) {
    throw new Error(
      `${resultPath} is not a valid train response: ${errorMessage(error)}`,
    );
  }
}

interface CliTrainPlan {
  binary: string;
  args: string[];
  outputDir: string;
  deadlineCapable: boolean;
}

/** Build the CLI args and write the backend report; shared by the sync and async paths. */
function prepareCliTrain(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): CliTrainPlan {
  const binary = findRustTrainDirBinary();
  if (binary === null) {
    throw new Error(
      "trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; " +
        "refusing WASM/TypeScript fallback (neat_ai_backpropagation binary was not found).",
    );
  }
  const deadlineCapability = cliDeadlineCapability(binary);
  const deadlineCapable = deadlineCapability !== undefined;

  const creaturePath = join(workDir, "creature.json");
  const outputDir = join(workDir, "out");
  Deno.mkdirSync(outputDir);
  const fields = buildTrainRequestFields(
    creature,
    dataDir,
    options,
    setup,
    outputDir,
  );
  Deno.writeTextFileSync(creaturePath, fields.creatureJson);

  const args = [
    "train",
    resolve(Deno.cwd(), creaturePath),
    fields.trainingData,
    "--epochs",
    String(fields.epochs),
    "--output-dir",
    fields.outputDir,
    "--learning-rate",
    String(fields.learningRate),
    "--learning-rate-strategy",
    toCliStrategy(fields.learningRateStrategy),
    "--learning-rate-decay",
    String(fields.learningRateDecay),
    "--maximum-bias-adjustment-scale",
    String(fields.maximumBiasAdjustmentScale),
    "--maximum-weight-adjustment-scale",
    String(fields.maximumWeightAdjustmentScale),
    "--step-scale",
    String(fields.stepScale),
    "--seed",
    String(fields.seed),
  ];
  if (fields.normaliseGradients) args.push("--normalise-gradients");
  if (fields.disableRandomSamples) args.push("--disable-random-samples");
  if (fields.maxRecords !== undefined) {
    args.push("--max-records", String(fields.maxRecords));
  }
  if (fields.traceStore !== undefined) {
    args.push("--trace-store", fields.traceStore);
  }
  let deadlineSent = false;
  if (deadlineCapable && setup.timeoutTS > 0) {
    args.push("--deadline-epoch-ms", String(Math.floor(setup.timeoutTS)));
    deadlineSent = true;
  }

  const backendKey = `cli:${binary}`;
  if (loggedTrainDirBackend !== binary) {
    loggedTrainDirBackend = binary;
    reportTrainDirMessage(
      "info",
      `[NEAT-AI] trainDir using CLI neat_ai_backpropagation at ${binary}`,
    );
  }
  if (!deadlineCapable && setup.timeoutTS > 0) {
    warnLegacyDeadlineOnce(
      backendKey,
      `CLI neat_ai_backpropagation at ${binary}`,
    );
  }

  reportTrainDirBackend(setup.ID, {
    backend: "cli",
    deadlineSent,
    capability: deadlineCapability === undefined
      ? "none"
      : String(deadlineCapability.version),
  });
  return { binary, args, outputDir, deadlineCapable };
}

/** Package a finished CLI run; shared by the sync and async paths. */
function finishCliTrain(
  creature: Creature,
  setup: TrainingSetupState,
  spawned: SpawnedTrain,
  plan: CliTrainPlan,
): TrainingResult {
  const { outputDir, deadlineCapable } = plan;
  // The result file is not read yet, so the outcome is unknown here.
  reportTrainDirPhase(setup.ID, {
    phase: "native-returned",
    timedOut: undefined,
    msFromDeadline: msFromDeadlineNow(setup),
  });
  if (!spawned.success) {
    throw new Error(
      `neat_ai_backpropagation train failed (exit ${spawned.code}): ` +
        spawned.stderr.trim(),
    );
  }

  if (deadlineCapable) {
    const response = readCliResultFile(outputDir);
    const bestJson = JSON.parse(response.bestCreatureJson) as CreatureExport;
    return packageTrainingResult(
      creature,
      setup,
      bestJson,
      summaryFromNativeResponse(response),
    );
  }

  const bestPath = join(outputDir, "best.json");
  const journalPath = join(outputDir, "journal.jsonl");
  const bestJson = JSON.parse(
    Deno.readTextFileSync(bestPath),
  ) as CreatureExport;
  const summary = summariseTrainJournal(journalPath);
  return packageTrainingResult(creature, setup, bestJson, summary);
}

function tryCliTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): TrainingResult {
  const plan = prepareCliTrain(creature, dataDir, options, setup, workDir);
  const spawned = spawnTrain(plan.binary, plan.args);
  return finishCliTrain(creature, setup, spawned, plan);
}

async function tryCliTrainDirAsync(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): Promise<TrainingResult> {
  const plan = prepareCliTrain(creature, dataDir, options, setup, workDir);
  const spawned = await spawnTrainAsync(plan.binary, plan.args);
  return finishCliTrain(creature, setup, spawned, plan);
}

/**
 * Run the Rust trainer and package a TypeScript {@link TrainingResult}.
 *
 * @returns the result, or `undefined` when the Rust trainer is not
 *          enabled or the request uses options the old WASM backprop
 *          never honoured. When the trainer **is** enabled, a request
 *          the old engine handled but Rust cannot (or a missing
 *          library/binary) throws — no silent WASM fallback.
 */
export function tryRustTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): TrainingResult | undefined {
  if (!rustTrainDirGate(creature, options, cost, setup)) return undefined;
  const workDir = Deno.makeTempDirSync({ prefix: "neat-ai-backprop-" });
  try {
    if (isNativeBackpropAvailable()) {
      return tryFfiTrainDir(creature, dataDir, options, setup, workDir);
    }
    refuseCliWhenFfiRequired();
    return tryCliTrainDir(creature, dataDir, options, setup, workDir);
  } finally {
    removeWorkDir(workDir);
  }
}

/**
 * Async twin of {@link tryRustTrainDir} for the worker path (Issue #4126): the
 * native trainer is awaited, so the thread is not blocked inside it.
 */
export async function tryRustTrainDirAsync(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): Promise<TrainingResult | undefined> {
  if (!rustTrainDirGate(creature, options, cost, setup)) return undefined;
  const workDir = await Deno.makeTempDir({ prefix: "neat-ai-backprop-" });
  try {
    if (isNativeBackpropAvailable()) {
      return await tryFfiTrainDirAsync(
        creature,
        dataDir,
        options,
        setup,
        workDir,
      );
    }
    refuseCliWhenFfiRequired();
    return await tryCliTrainDirAsync(
      creature,
      dataDir,
      options,
      setup,
      workDir,
    );
  } finally {
    await removeWorkDirAsync(workDir);
  }
}

/** False to skip Rust; throws when Rust is enabled but cannot take the request. */
function rustTrainDirGate(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): boolean {
  if (!isRustTrainDirEnabled()) return false;
  if (rustTrainDirSkipReason(creature, options, cost, setup) !== undefined) {
    return false;
  }
  const reason = rustTrainDirRefusalReason(creature, options, cost, setup);
  if (reason !== undefined) {
    throw new Error(
      `trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; ` +
        `refusing WASM/TypeScript fallback (${reason}).`,
    );
  }
  return true;
}

function refuseCliWhenFfiRequired(): void {
  if (isRustTrainDirFfiRequired()) {
    throw new Error(
      "trainDir must use libneat_ai_backpropagation FFI when REQUIRE_FFI is set; " +
        "refusing CLI/WASM fallback.",
    );
  }
}

async function removeWorkDirAsync(workDir: string): Promise<void> {
  try {
    await Deno.remove(workDir, { recursive: true });
  } catch {
    // Temp dir cleanup is best-effort.
  }
}

function removeWorkDir(workDir: string): void {
  try {
    Deno.removeSync(workDir, { recursive: true });
  } catch {
    // Temp dir cleanup is best-effort.
  }
}

/** Test helper: unload the FFI library between suites. */
export function __closeNativeBackpropLibraryForTests(): void {
  closeNativeBackpropLibrary();
}
