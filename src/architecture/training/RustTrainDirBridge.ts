/**
 * Spawn sibling `neat_ai_backpropagation train` from `trainDir` (Issue #3741).
 *
 * Production `evolveDir` reaches this path indirectly. The CLI owns the epoch
 * loop in native Rust (creature JSON + `.bin` directory → accumulate → apply →
 * MSE accept/rollback). TypeScript keeps predictive coding, cross-validation,
 * custom costs, dropout, fuzzing, quantisation, Muon, and recurrent graphs.
 *
 * Default on when `neat_ai_backpropagation` resolves and the request is
 * eligible. Set `NEAT_AI_BACKPROP_ENABLED=0` to force the TypeScript / WASM
 * loop (escape hatch while production soaks the native path).
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

/** Matches journal lines written by neat_ai_backpropagation `train.rs`. */
interface TrainJournalHeader {
  kind: string;
  epochs: number;
}

interface TrainEpochRecord {
  kind: string;
  epoch: number;
  afterMse: number;
  accepted: boolean;
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

function timeoutSeconds(setup: TrainingSetupState): number | undefined {
  const caps: number[] = [];
  if (setup.trainingTimeOutMinutes > 0) {
    caps.push(setup.trainingTimeOutMinutes * 60);
  }
  if (setup.hardDeadlineTS !== undefined && setup.hardDeadlineTS > 0) {
    const remain = (setup.hardDeadlineTS - Date.now()) / 1000;
    if (remain > 0) caps.push(remain);
  }
  if (caps.length === 0) return undefined;
  return Math.max(1, Math.floor(Math.min(...caps)));
}

/** True when an env flag is an explicit off value (`0` / `false` / `no` / `off`). */
function envFlagDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * True when `trainDir` should prefer the Rust trainer when eligible.
 *
 * Default is on. Set `NEAT_AI_BACKPROP_ENABLED=0` to force TypeScript / WASM.
 */
export function isRustTrainDirEnabled(): boolean {
  return !envFlagDisabled(readEnvString("NEAT_AI_BACKPROP_ENABLED"));
}

function stepScale(): number {
  const raw = readEnvString("NEAT_AI_BACKPROP_STEP_SCALE");
  if (raw === undefined) return 0.01;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : 0.01;
}

/**
 * True when this `trainDir` request is one the Rust trainer can honour.
 *
 * Custom costs, recurrent graphs, and the TypeScript-only regularisers stay
 * on the existing loop so those tests remain unaltered. Partial corpus
 * samples map to `--max-records`.
 */
export function canUseRustTrainDir(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
  enabled: boolean = isRustTrainDirEnabled(),
): boolean {
  if (!enabled) return false;
  if (creature.forwardOnly !== true) return false;
  if (options.feedbackLoop === true) return false;
  if (cost.getName() !== MSE.NAME) return false;
  if (setup.fuzzingConfig.enabled) return false;
  if (setup.quantisationConfig.enabled) return false;
  if (setup.iterationConfig.dropoutRate > 0) return false;
  if (setup.iterationConfig.gradientOrthogonalisation === "muon") {
    return false;
  }
  return findRustTrainDirBinary() !== null;
}

function countDatasetRecords(
  dataDir: string,
  input: number,
  output: number,
): number {
  const bytesPerRecord = (input + output) * Float32Array.BYTES_PER_ELEMENT;
  if (bytesPerRecord <= 0) return 0;
  let total = 0;
  try {
    for (const entry of Deno.readDirSync(dataDir)) {
      if (!entry.isFile || !entry.name.endsWith(".bin")) continue;
      total += Math.floor(
        Deno.statSync(join(dataDir, entry.name)).size / bytesPerRecord,
      );
    }
  } catch {
    return 0;
  }
  return total;
}

function summariseJournal(
  journalPath: string,
  requestedEpochs: number,
): { completedEpochs: number; bestMse: number } {
  let completedEpochs = 0;
  let bestMse = Number.POSITIVE_INFINITY;
  let baselineMse = Number.POSITIVE_INFINITY;
  try {
    const text = Deno.readTextFileSync(journalPath);
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const row = JSON.parse(line) as TrainJournalHeader & TrainEpochRecord & {
        beforeMse?: number;
      };
      if (row.kind === "epoch") {
        completedEpochs++;
        if (
          !Number.isFinite(baselineMse) &&
          typeof row.beforeMse === "number" &&
          Number.isFinite(row.beforeMse)
        ) {
          baselineMse = row.beforeMse;
        }
        if (row.accepted && Number.isFinite(row.afterMse)) {
          bestMse = Math.min(bestMse, row.afterMse);
        }
      }
    }
  } catch {
    // Journal is best-effort; callers may still have best.json.
  }
  if (!Number.isFinite(bestMse)) {
    bestMse = Number.isFinite(baselineMse)
      ? baselineMse
      : Number.POSITIVE_INFINITY;
  }
  if (completedEpochs === 0) completedEpochs = Math.max(1, requestedEpochs);
  return { completedEpochs, bestMse };
}

function spawnTrain(
  binary: string,
  args: string[],
  timeoutSec: number | undefined,
): {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
} {
  const signal = timeoutSec !== undefined && timeoutSec > 0
    ? AbortSignal.timeout(Math.max(1, Math.floor(timeoutSec * 1000)))
    : undefined;
  try {
    const output = new Deno.Command(binary, {
      args,
      stdout: "piped",
      stderr: "piped",
      signal,
    }).outputSync();
    return {
      success: output.success,
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
      timedOut: false,
    };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return {
      success: false,
      code: timedOut ? 124 : 1,
      stdout: "",
      stderr: timedOut
        ? `neat_ai_backpropagation timed out after ${timeoutSec}s`
        : String(err),
      timedOut,
    };
  }
}

/**
 * Run the Rust trainer and package a TypeScript {@link TrainingResult}.
 *
 * @returns the result, or `undefined` when this request should stay on the
 *          TypeScript loop (ineligible, missing binary, or CLI failure).
 */
export function tryRustTrainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): TrainingResult | undefined {
  if (!canUseRustTrainDir(creature, options, cost, setup)) {
    return undefined;
  }
  const binary = findRustTrainDirBinary();
  if (binary === null) return undefined;

  const workDir = Deno.makeTempDirSync({ prefix: "neat-ai-backprop-" });
  const creaturePath = join(workDir, "creature.json");
  const outputDir = join(workDir, "out");
  Deno.mkdirSync(outputDir);
  Deno.writeTextFileSync(
    creaturePath,
    JSON.stringify(creature.exportJSON()),
  );

  const cfg = setup.iterationConfig;
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
  if (options.disableRandomSamples === true) {
    args.push("--disable-random-samples");
  }
  if (setup.trainingSampleRate > 0 && setup.trainingSampleRate < 1) {
    const total = countDatasetRecords(dataDir, creature.input, creature.output);
    const capped = Math.max(1, Math.floor(total * setup.trainingSampleRate));
    if (total > 0) {
      args.push("--max-records", String(capped));
    }
  }
  if (options.traceStore) {
    args.push("--trace-store", resolve(Deno.cwd(), options.traceStore));
  }

  getLogger().info(
    `[NEAT-AI] trainDir using native neat_ai_backpropagation at ${binary}`,
  );

  try {
    const spawned = spawnTrain(binary, args, timeoutSeconds(setup));
    const bestPath = join(outputDir, "best.json");
    const journalPath = join(outputDir, "journal.jsonl");
    let hasBest = false;
    try {
      hasBest = Deno.statSync(bestPath).isFile;
    } catch {
      hasBest = false;
    }

    if (!spawned.success && !spawned.timedOut) {
      getLogger().warn(
        `[NEAT-AI] neat_ai_backpropagation train failed (exit ${spawned.code}); ` +
          `falling back to TypeScript / WASM. ${spawned.stderr.trim()}`,
      );
      return undefined;
    }

    if (!hasBest) {
      getLogger().warn(
        spawned.timedOut
          ? "[NEAT-AI] neat_ai_backpropagation timed out with no best.json; " +
            "falling back to TypeScript / WASM."
          : "[NEAT-AI] neat_ai_backpropagation wrote no best.json; " +
            "falling back to TypeScript / WASM.",
      );
      return undefined;
    }

    const bestJson = JSON.parse(
      Deno.readTextFileSync(bestPath),
    ) as CreatureExport;
    const { completedEpochs, bestMse } = summariseJournal(
      journalPath,
      setup.iterations,
    );

    creature.loadFrom(bestJson, false, "training:rustTrainDir");

    const loop: TrainingLoopResult = {
      iteration: Math.max(1, completedEpochs),
      bestError: Number.isFinite(bestMse) ? bestMse : Number.POSITIVE_INFINITY,
      bestCreatureJSON: creature.exportJSON(),
      bestTraceJSON: creature.traceJSON(),
      sparseConfig: setup.sparseConfig,
      timedOut: spawned.timedOut,
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
  } catch (err) {
    getLogger().warn(
      `[NEAT-AI] neat_ai_backpropagation train raised; falling back to ` +
        `TypeScript / WASM. ${err}`,
    );
    return undefined;
  } finally {
    try {
      Deno.removeSync(workDir, { recursive: true });
    } catch {
      // Temp dir cleanup is best-effort.
    }
  }
}
