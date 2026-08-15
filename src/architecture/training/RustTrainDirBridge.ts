/**
 * Spawn sibling `neat_ai_backpropagation train` from `trainDir` (Issue #3741).
 *
 * Production `evolveDir` reaches this path indirectly. The CLI owns the epoch
 * loop in native Rust (creature JSON + `.bin` directory → accumulate → apply →
 * MSE accept/rollback). Options the old WASM `propagateTopological`
 * engine never honoured — and options that are not backpropagation —
 * skip the Rust app (predictive coding, cross-validation, custom
 * costs, dropout, fuzzing, quantisation, Muon, recurrent /
 * `feedbackLoop`). `trainingSampleRate` is forwarded as `--max-records`.
 *
 * Default on for eligible `trainDir` (set `NEAT_AI_BACKPROP_ENABLED=0` to
 * force the TypeScript / WASM loop). `./quality.sh --next` still builds the
 * sibling binary and sets `NEAT_AI_BACKPROP_ENABLED=1`. When enabled there
 * is no silent WASM fallback for a request the old engine *did* handle: a
 * missing binary is an error.
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

function envFlagEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return v === "1" || v === "true" || v === "yes";
}

let testEnabledOverride: boolean | undefined;
let loggedTrainDirBinary: string | undefined;
let legacyWrapperDepth = 0;

/** Isolate-local enable override for tests (do not mutate process env). */
export function __setRustTrainDirEnabledForTests(
  enabled: boolean | undefined,
): void {
  testEnabledOverride = enabled;
}

/**
 * True when `trainDir` should spawn the Rust trainer for eligible requests.
 *
 * Default is on. Set `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript /
 * WASM loop. `./quality.sh` without `--next` sets that so the WASM path
 * stays covered; `./quality.sh --next` sets `=1` and requires the binary.
 */
export function isRustTrainDirEnabled(): boolean {
  if (testEnabledOverride !== undefined) return testEnabledOverride;
  return envFlagEnabled(readEnvString("NEAT_AI_BACKPROP_ENABLED"));
}

function stepScale(): number {
  const raw = readEnvString("NEAT_AI_BACKPROP_STEP_SCALE");
  if (raw === undefined) return 0.01;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : 0.01;
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
 * Rust trainer to support). When set, do not spawn the Rust app —
 * keep the TypeScript wrappers.
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
  if (findRustTrainDirBinary() === null) {
    return "neat_ai_backpropagation binary was not found";
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

/**
 * Run the Rust trainer and package a TypeScript {@link TrainingResult}.
 *
 * @returns the result, or `undefined` when the Rust trainer is not
 *          enabled or the request uses options the old WASM backprop
 *          never honoured. When the trainer **is** enabled, a request
 *          the old engine handled but Rust cannot (or a missing binary)
 *          throws — no silent WASM fallback.
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
  const binary = findRustTrainDirBinary();
  if (binary === null) {
    throw new Error(
      "trainDir must use neat_ai_backpropagation when Rust trainDir is enabled; " +
        "refusing WASM/TypeScript fallback (neat_ai_backpropagation binary was not found).",
    );
  }

  const workDir = Deno.makeTempDirSync({ prefix: "neat-ai-backprop-" });
  const creaturePath = join(workDir, "creature.json");
  const outputDir = join(workDir, "out");
  Deno.mkdirSync(outputDir);
  Deno.writeTextFileSync(
    creaturePath,
    JSON.stringify(creature.exportJSON()),
  );

  const cfg = setup.iterationConfig;
  // Only flags the current `neat_ai_backpropagation train` CLI accepts.
  // Unknown flags (sparse-ratio, generations, target-error, …) are an
  // error from the binary — do not invent a WASM fallback.
  const args = [
    "train",
    resolve(Deno.cwd(), creaturePath),
    resolve(Deno.cwd(), dataDir),
    "--epochs",
    String(setup.iterations),
    "--output-dir",
    resolve(Deno.cwd(), outputDir),
    "--learning-rate",
    String(cfg.learningRate),
    "--learning-rate-strategy",
    toCliStrategy(cfg.learningRateStrategy),
    "--learning-rate-decay",
    String(cfg.learningRateDecay),
    "--maximum-bias-adjustment-scale",
    String(cfg.maximumBiasAdjustmentScale),
    "--maximum-weight-adjustment-scale",
    String(cfg.maximumWeightAdjustmentScale),
    "--step-scale",
    String(stepScale()),
  ];
  if (cfg.normaliseGradients) args.push("--normalise-gradients");
  if (setup.trainingSampleRate < 1) {
    const total = countDatasetRecords(dataDir, setup.BYTES_PER_RECORD);
    const maxRecords = Math.max(
      1,
      Math.ceil(total * setup.trainingSampleRate),
    );
    args.push("--max-records", String(maxRecords));
  }

  if (loggedTrainDirBinary !== binary) {
    loggedTrainDirBinary = binary;
    getLogger().info(
      `[NEAT-AI] trainDir using native neat_ai_backpropagation at ${binary}`,
    );
  }

  try {
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
  } finally {
    try {
      Deno.removeSync(workDir, { recursive: true });
    } catch {
      // Temp dir cleanup is best-effort.
    }
  }
}
