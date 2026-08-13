/**
 * Spawn sibling `neat_ai_backpropagation train` from `trainDir` (Issue #3741).
 *
 * Production `evolveDir` reaches this path indirectly. The CLI owns the epoch
 * loop in native Rust (creature JSON + `.bin` directory → accumulate → apply →
 * MSE accept/rollback). TypeScript keeps predictive coding, cross-validation,
 * custom costs, dropout, fuzzing, quantisation, Muon, and recurrent graphs.
 *
 * Later this host call can be made optional; for now it is the default whenever
 * the binary is present and the request is one the trainer can honour.
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

/** Matches `TrainSummary` in neat_ai_backpropagation `train.rs`. */
interface TrainSummary {
  baselineMse: number;
  bestMse: number;
  acceptedEpochs: number;
  completedEpochs: number;
  timedOut: boolean;
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
 * on the existing loop so those tests remain unaltered.
 */
export function canUseRustTrainDir(
  creature: Creature,
  options: TrainOptions,
  cost: CostInterface,
  setup: TrainingSetupState,
): boolean {
  if (creature.forwardOnly !== true) return false;
  if (options.feedbackLoop === true) return false;
  if (cost.getName() !== MSE.NAME) return false;
  if (setup.fuzzingConfig.enabled) return false;
  if (setup.quantisationConfig.enabled) return false;
  if (setup.iterationConfig.dropoutRate > 0) return false;
  if (setup.iterationConfig.gradientOrthogonalisation === "muon") {
    return false;
  }
  if (setup.trainingSampleRate < 1) return false;
  return findRustTrainDirBinary() !== null;
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
 * @returns the result, or `undefined` when this request should stay on the
 *          TypeScript loop.
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
    "--sparse-ratio",
    String(cfg.sparseRatio),
    "--generations",
    String(cfg.generations),
    "--step-scale",
    String(stepScale()),
    "--target-error",
    String(setup.targetError),
  ];
  if (cfg.normaliseGradients) args.push("--normalise-gradients");
  if (options.disableRandomSamples !== true) args.push("--random-samples");
  const timeout = timeoutSeconds(setup);
  if (timeout !== undefined) {
    args.push("--timeout-seconds", String(timeout));
  }

  getLogger().info(
    `[NEAT-AI] trainDir using native neat_ai_backpropagation at ${binary}`,
  );

  try {
    const spawned = spawnTrain(binary, args);
    if (!spawned.success) {
      throw new Error(
        `neat_ai_backpropagation train failed (exit ${spawned.code}): ` +
          spawned.stderr.trim(),
      );
    }

    const bestPath = join(outputDir, "best.json");
    const summaryPath = join(outputDir, "summary.json");
    const bestJson = JSON.parse(
      Deno.readTextFileSync(bestPath),
    ) as CreatureExport;
    const summary = JSON.parse(
      Deno.readTextFileSync(summaryPath),
    ) as TrainSummary;

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
