/**
 * Drive eligible `trainDir` through sibling `neat_ai_backpropagation`
 * (Issues #3741, #3765).
 *
 * Prefers in-process Deno FFI (`libneat_ai_backpropagation`, Backpropagation
 * #84) when the cdylib resolves. Falls back to spawning the CLI binary when
 * the library is absent. `./quality.sh --next` requires the FFI library so
 * that path is exercised; set `NEAT_AI_BACKPROP_REQUIRE_FFI=1` to refuse the
 * CLI fallback in other environments.
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

import { fromFileUrl } from "@std/path/from-file-url";
import { join, resolve } from "@std/path";
import type { CostInterface } from "@costs/CostInterface.ts";
import { MSE } from "@costs/MSE.ts";
import type { Creature } from "@creature";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { getLogger } from "@utils/Logger.ts";
import { finaliseTraining } from "@architecture/training/TrainingTeardown.ts";
import type { TrainingSetupState } from "@architecture/training/TrainingSetup.ts";
import type { TrainingLoopResult } from "@architecture/training/TrainingLoop.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import { readDatasetDirEntriesSync } from "@architecture/DatasetIO.ts";
import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  isNativeBackpropAvailable,
  nativeBackpropTrain,
  type NativeBackpropTrainRequest,
} from "@architecture/training/NativeBackpropLibrary.ts";

/** Derived from `journal.jsonl` epoch lines (`TrainEpochRecord`). */
interface TrainSummary {
  baselineMse: number;
  bestMse: number;
  acceptedEpochs: number;
  completedEpochs: number;
  timedOut: boolean;
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

function siblingReleaseBinary(): string {
  return fromFileUrl(
    new URL(
      "../../../../NEAT-AI-Backpropagation/target/release/" +
        rustTrainDirFileName(),
      import.meta.url,
    ),
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
  const siblingTarget = resolveBinaryCandidate(sibling);
  if (siblingTarget) return siblingTarget;

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
 * (`0` / `false` / `no`) forces the TypeScript / WASM loop.
 */
export function parseRustTrainDirEnabledFlag(
  raw: string | undefined,
): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
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
  if (options.predictiveCoding?.enabled) {
    return "predictive coding is not backpropagation";
  }
  if (options.crossValidation?.enabled) {
    return "cross-validation is TypeScript fold orchestration";
  }
  if (cost.getName() !== MSE.NAME) {
    return `cost ${cost.getName()} is not used by WASM backprop`;
  }
  if (setup.fuzzingConfig.enabled) {
    return "fuzzing is not backpropagation";
  }
  if (setup.quantisationConfig.enabled) {
    return "quantisation is not backpropagation";
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

function spawnTrain(
  binary: string,
  args: string[],
): { success: boolean; code: number; stdout: string; stderr: string } {
  const output = new Deno.Command(binary, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
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

function packageTrainingResult(
  creature: Creature,
  setup: TrainingSetupState,
  bestJson: CreatureExport,
  summary: TrainSummary,
): TrainingResult {
  creature.loadFrom(bestJson, false, "training:rustTrainDir");

  const loop: TrainingLoopResult = {
    iteration: Math.max(1, summary.completedEpochs),
    bestError: summary.bestMse,
    bestCreatureJSON: creature.exportJSON(),
    bestTraceJSON: creature.traceJSON(),
    sparseConfig: setup.sparseConfig,
    timedOut: summary.timedOut,
  };

  return finaliseTraining(
    creature,
    loop,
    setup.iterationConfig,
    setup.iterations,
    setup.feedbackLoop,
    setup.syntheticKeys,
    setup.ID,
  );
}

function tryFfiTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): TrainingResult {
  const outputDir = join(workDir, "out");
  Deno.mkdirSync(outputDir);
  const fields = buildTrainRequestFields(
    creature,
    dataDir,
    options,
    setup,
    outputDir,
  );
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
  };

  const backendKey = `ffi:${findNativeBackpropLibrary() ?? "loaded"}`;
  if (loggedTrainDirBackend !== backendKey) {
    loggedTrainDirBackend = backendKey;
    getLogger().info(
      `[NEAT-AI] trainDir using FFI libneat_ai_backpropagation`,
    );
  }

  const response = nativeBackpropTrain(request);
  const bestJson = JSON.parse(response.bestCreatureJson) as CreatureExport;
  const summary: TrainSummary = {
    baselineMse: response.baselineMse,
    bestMse: response.bestMse,
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

function tryCliTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  setup: TrainingSetupState,
  workDir: string,
): TrainingResult {
  const binary = findRustTrainDirBinary();
  if (binary === null) {
    throw new Error(
      "trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; " +
        "refusing WASM/TypeScript fallback (neat_ai_backpropagation binary was not found).",
    );
  }

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

  if (loggedTrainDirBackend !== binary) {
    loggedTrainDirBackend = binary;
    getLogger().info(
      `[NEAT-AI] trainDir using CLI neat_ai_backpropagation at ${binary}`,
    );
  }

  const spawned = spawnTrain(binary, args);
  if (!spawned.success) {
    throw new Error(
      `neat_ai_backpropagation train failed (exit ${spawned.code}): ` +
        spawned.stderr.trim(),
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
  if (!isRustTrainDirEnabled()) {
    return undefined;
  }
  if (rustTrainDirSkipReason(creature, options, cost, setup) !== undefined) {
    return undefined;
  }
  const reason = rustTrainDirRefusalReason(creature, options, cost, setup);
  if (reason !== undefined) {
    throw new Error(
      `trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; ` +
        `refusing WASM/TypeScript fallback (${reason}).`,
    );
  }

  const workDir = Deno.makeTempDirSync({ prefix: "neat-ai-backprop-" });
  try {
    if (isNativeBackpropAvailable()) {
      return tryFfiTrainDir(creature, dataDir, options, setup, workDir);
    }
    if (isRustTrainDirFfiRequired()) {
      throw new Error(
        "trainDir must use libneat_ai_backpropagation FFI when REQUIRE_FFI is set; " +
          "refusing CLI/WASM fallback.",
      );
    }
    return tryCliTrainDir(creature, dataDir, options, setup, workDir);
  } finally {
    try {
      Deno.removeSync(workDir, { recursive: true });
    } catch {
      // Temp dir cleanup is best-effort.
    }
  }
}

/** Test helper: unload the FFI library between suites. */
export function __closeNativeBackpropLibraryForTests(): void {
  closeNativeBackpropLibrary();
}
