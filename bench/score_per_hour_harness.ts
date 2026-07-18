/**
 * Issue #3398 — Score-per-wall-clock-hour benchmark harness.
 *
 * The agreed success metric for the #3396 evolution-performance milestone is
 * **score improvement per wall-clock hour** inside the production learn/sampler
 * time-boxes — not raw throughput. This harness measures that metric directly
 * so every #3396 implementation sub-issue can show honest, apples-to-apples
 * before/after evidence within a fixed time budget.
 *
 * What it does:
 *   1. Deterministically generates the production-scale synthetic topology used
 *      by `worker/learn.sh` / `worker/sampler.sh` (the `grq-3397` preset:
 *      ~1,666 neurons / ~21,513 synapses / 2,461 inputs) via the shared
 *      `test/propagate/large/ProductionScaleCreature.ts` generators.
 *   2. Runs `evolveDataSet` under a fixed wall-clock budget (or generation cap),
 *      seeding the NEAT RNG so runs are reproducible.
 *   3. Records a **score-vs-time curve** (best/average fitness at each
 *      generation, with cumulative wall-clock elapsed) and derives the
 *      **score gained per hour**.
 *   4. Emits machine-readable JSON for CI/regression tracking.
 *
 * Determinism: the NEAT engine is seeded (`seed`), so the score trajectory
 * (generation → best/average fitness) is byte-identical across runs. Wall-clock
 * timing is injected via a `now()` clock so a determinism smoke test can drive
 * a virtual clock and get byte-identical timing too; production runs use
 * `performance.now()`.
 *
 * Silent-failure guard (Issue #3234): the run throws if it produced no score
 * samples, so a wedged learn/sampler invocation surfaces as a hard failure
 * rather than an empty report.
 *
 * CLI:
 *   deno run --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/score_per_hour_harness.ts \
 *     --scale=grq-3397 --time-budget-ms=2700000 --max-generations=100 \
 *     --population=20 --seed=3396 --out=trajectory.json
 *
 *   # Regression gate against the checked-in baseline:
 *   deno run ... bench/score_per_hour_harness.ts \
 *     --baseline=bench/baseline_score_trajectory.json
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "../test/propagate/large/ProductionScaleCreature.ts";

/** Machine-readable output schema version. Bump on breaking shape changes. */
export const HARNESS_SCHEMA_VERSION = 1 as const;

/** Configuration for a single harness run. Fully serialised into the output. */
export interface HarnessConfig {
  /** Seed for the NEAT RNG and the synthetic generators — drives reproducibility. */
  readonly seed: number;
  /** Synthetic topology preset from ProductionScaleCreature. */
  readonly scale: "default" | "grq-cluster" | "grq-3397";
  /** Number of inputs (2,461 matches the production `network.json`). */
  readonly inputCount: number;
  /** Number of outputs. */
  readonly outputCount: number;
  /** Number of synthetic training samples. */
  readonly sampleCount: number;
  /** Population size (`worker/learn.sh` production value is 20). */
  readonly populationSize: number;
  /** Hard generation cap — the run also stops at `timeBudgetMs`. */
  readonly maxGenerations: number;
  /** Wall-clock budget in milliseconds (learn.sh ≈ 45 min; sampler ≈ 1 h). */
  readonly timeBudgetMs: number;
  /** Worker threads (1 keeps the harness deterministic and portable). */
  readonly threads: number;
  /**
   * Backprop training sessions per generation. Defaults to `0` — pure seeded
   * neuroevolution (mutation + selection), which is byte-reproducible and still
   * improves the score across generations. Async backprop training (`>= 1`)
   * makes score improvement faster but completes on worker threads whose
   * scheduling is wall-clock-dependent, so runs are seeded-but-not-byte-
   * identical; use it for a production-faithful measurement, not the
   * determinism smoke test.
   */
  readonly trainPerGen: number;
  /**
   * Discovery sample rate passed straight to `evolveDataSet`. Defaults to `-1`
   * (discovery disabled) so the measured score trajectory depends only on the
   * seeded evolution loop and is byte-reproducible — the native discovery
   * library adds FFI, disk, and timing non-determinism that would break the
   * determinism guarantee. Raise it for a fuller production-faithful run.
   */
  readonly discoverySampleRate: number;
  /**
   * Optional path to a real `.trainData` JSON sample (array of
   * `{ input, output }`). When set, its records replace the synthetic training
   * data so the harness can sanity-check against real data where cheap.
   */
  readonly trainDataPath?: string;
  /**
   * Extra `NeatOptions` merged into the `evolveDataSet` call (Issue #3400).
   * Lets a config sweep vary the evolution-mode flags plus `trainingSampleRate`
   * / `sparseRatio` that `worker/learn.sh` sets, without adding a harness field
   * per knob. These are spread in **first**, so the harness keeps control of
   * the determinism-critical fields (`seed`, `threads`, `iterations`,
   * `timeoutMinutes`, `trainPerGen`, `discoverySampleRate`, `populationSize`,
   * and the `onTrainingEvent` sampler) — a sweep can never accidentally break
   * seeding or the score-vs-time capture.
   */
  readonly extraOptions?: Partial<NeatOptions>;
}

/** One point on the score-vs-time curve. */
export interface ScoreSample {
  /** 1-based generation number. */
  readonly generation: number;
  /** Cumulative wall-clock milliseconds since the run started. */
  readonly elapsedMs: number;
  /** Best fitness in the population at this generation (higher is better). */
  readonly bestFitness: number;
  /** Average fitness across the population at this generation. */
  readonly averageFitness: number;
}

/** Full machine-readable harness result. */
export interface HarnessResult {
  readonly schemaVersion: number;
  readonly config: HarnessConfig;
  /** Actual topology exercised — a guard that the preset matches production. */
  readonly topology: {
    readonly neurons: number;
    readonly synapses: number;
    readonly inputs: number;
  };
  /** Whether the real `.trainData` sample was used instead of synthetic data. */
  readonly usedRealTrainData: boolean;
  /** The score-vs-time curve. */
  readonly scoreTrajectory: readonly ScoreSample[];
  /** Best fitness of the first recorded generation. */
  readonly initialBestFitness: number;
  /** Best fitness of the last recorded generation. */
  readonly finalBestFitness: number;
  /** Maximum best fitness reached anywhere in the trajectory. */
  readonly bestFitness: number;
  /** Total wall-clock milliseconds for the run. */
  readonly totalElapsedMs: number;
  /**
   * Score gained per wall-clock hour:
   * `(finalBestFitness - initialBestFitness) / (totalElapsedMs / 3_600_000)`.
   * `0` when no measurable time elapsed.
   */
  readonly scorePerHour: number;
}

/** Options that steer the run but are not serialised into the result. */
export interface RunOptions {
  /**
   * Injectable monotonic clock in milliseconds. Defaults to
   * `performance.now()`. A determinism test injects a virtual clock so the
   * timing fields become byte-reproducible.
   */
  readonly now?: () => number;
}

/** Fill in the defaults for a partial config (used by the CLI). */
export function withConfigDefaults(
  partial: Partial<HarnessConfig> = {},
): HarnessConfig {
  return {
    seed: partial.seed ?? 3396,
    scale: partial.scale ?? "grq-3397",
    inputCount: partial.inputCount ?? 2461,
    outputCount: partial.outputCount ?? 2,
    sampleCount: partial.sampleCount ?? 50,
    populationSize: partial.populationSize ?? 20,
    maxGenerations: partial.maxGenerations ?? 100,
    timeBudgetMs: partial.timeBudgetMs ?? 45 * 60_000,
    threads: partial.threads ?? 1,
    trainPerGen: partial.trainPerGen ?? 0,
    discoverySampleRate: partial.discoverySampleRate ?? -1,
    trainDataPath: partial.trainDataPath,
    extraOptions: partial.extraOptions,
  };
}

/** Load and validate a real `.trainData` sample into typed records. */
async function loadRealTrainData(
  path: string,
): Promise<DataRecordInterface[]> {
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text);
  const rawRecords: unknown = Array.isArray(parsed) ? parsed : parsed?.data;
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    throw new Error(
      `trainData sample '${path}' must be a non-empty array of {input, output} records`,
    );
  }
  return rawRecords.map((record, index) => {
    const rec = record as { input?: unknown; output?: unknown };
    if (!Array.isArray(rec.input) || !Array.isArray(rec.output)) {
      throw new Error(
        `trainData sample '${path}' record ${index} is missing numeric input/output arrays`,
      );
    }
    return {
      input: new Float32Array(rec.input as number[]),
      output: new Float32Array(rec.output as number[]),
    };
  });
}

/**
 * Run the harness and return the machine-readable trajectory + score/hour.
 *
 * Throws when the run produces no score samples (Issue #3234 — never report an
 * empty run as a clean outcome).
 */
export async function runScorePerHourHarness(
  config: HarnessConfig,
  options: RunOptions = {},
): Promise<HarnessResult> {
  const now = options.now ?? (() => performance.now());

  const creatureRng = createSeededRng(config.seed);
  const creatureExport: CreatureExport = generateProductionCreature(
    config.inputCount,
    config.outputCount,
    creatureRng,
    { scale: config.scale },
  );

  let trainingData: DataRecordInterface[];
  let usedRealTrainData = false;
  if (config.trainDataPath) {
    trainingData = await loadRealTrainData(config.trainDataPath);
    usedRealTrainData = true;
  } else {
    const dataRng = createSeededRng(config.seed + 1_000);
    trainingData = generateTrainingData(
      config.inputCount,
      config.outputCount,
      config.sampleCount,
      dataRng,
    );
  }

  const samples: ScoreSample[] = [];
  const start = now();

  const evolveOptions: NeatOptions = {
    // Sweep-supplied knobs first; harness-controlled fields below win.
    ...config.extraOptions,
    iterations: config.maxGenerations,
    timeoutMinutes: config.timeBudgetMs / 60_000,
    targetError: 0,
    populationSize: config.populationSize,
    threads: config.threads,
    seed: config.seed,
    trainPerGen: config.trainPerGen,
    discoverySampleRate: config.discoverySampleRate,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        samples.push({
          generation: event.generation,
          elapsedMs: now() - start,
          bestFitness: event.bestFitness,
          averageFitness: event.averageFitness,
        });
      }
    },
  };

  const creature = Creature.fromJSON(creatureExport);
  await creature.evolveDataSet(trainingData, evolveOptions);

  const totalElapsedMs = now() - start;

  return summariseTrajectory(samples, totalElapsedMs, {
    config,
    topology: {
      neurons: creatureExport.neurons.length,
      synapses: creatureExport.synapses.length,
      inputs: creatureExport.input,
    },
    usedRealTrainData,
  });
}

/**
 * Derive the score-per-hour summary from a raw score-vs-time curve.
 *
 * Silent-failure guard (Issue #3234): throws when the curve is empty — an empty
 * curve means the run wedged or completed no generation, and reporting it as a
 * clean result would mask the fault.
 */
export function summariseTrajectory(
  samples: readonly ScoreSample[],
  totalElapsedMs: number,
  meta: {
    config: HarnessConfig;
    topology: HarnessResult["topology"];
    usedRealTrainData: boolean;
  },
): HarnessResult {
  if (samples.length === 0) {
    throw new Error(
      "Score-per-hour harness produced no score samples — the evolution run " +
        "completed no generations within the time budget. Refusing to emit an " +
        "empty trajectory (Issue #3234).",
    );
  }

  const initialBestFitness = samples[0].bestFitness;
  const finalBestFitness = samples[samples.length - 1].bestFitness;
  const bestFitness = samples.reduce(
    (max, s) => (s.bestFitness > max ? s.bestFitness : max),
    samples[0].bestFitness,
  );
  const elapsedHours = totalElapsedMs / 3_600_000;
  const scorePerHour = elapsedHours > 0
    ? (finalBestFitness - initialBestFitness) / elapsedHours
    : 0;

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    config: meta.config,
    topology: meta.topology,
    usedRealTrainData: meta.usedRealTrainData,
    scoreTrajectory: samples,
    initialBestFitness,
    finalBestFitness,
    bestFitness,
    totalElapsedMs,
    scorePerHour,
  };
}

/**
 * Schema-validate a parsed harness result. Returns the list of problems found
 * (empty array = valid). Used by the determinism smoke test and the CLI so a
 * malformed output fails CI rather than being silently trusted.
 */
export function validateHarnessResult(value: unknown): string[] {
  const problems: string[] = [];
  const isFiniteNumber = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);

  if (typeof value !== "object" || value === null) {
    return ["result is not an object"];
  }
  const r = value as Record<string, unknown>;

  if (r.schemaVersion !== HARNESS_SCHEMA_VERSION) {
    problems.push(
      `schemaVersion must be ${HARNESS_SCHEMA_VERSION}, got ${
        String(r.schemaVersion)
      }`,
    );
  }
  if (typeof r.config !== "object" || r.config === null) {
    problems.push("config missing");
  }
  const topology = r.topology as Record<string, unknown> | undefined;
  if (
    !topology || !isFiniteNumber(topology.neurons) ||
    !isFiniteNumber(topology.synapses) || !isFiniteNumber(topology.inputs)
  ) {
    problems.push("topology missing numeric neurons/synapses/inputs");
  }
  if (typeof r.usedRealTrainData !== "boolean") {
    problems.push("usedRealTrainData must be a boolean");
  }

  const trajectory = r.scoreTrajectory;
  if (!Array.isArray(trajectory) || trajectory.length === 0) {
    problems.push("scoreTrajectory must be a non-empty array");
  } else {
    trajectory.forEach((sample, index) => {
      const s = sample as Record<string, unknown>;
      if (!isFiniteNumber(s.generation)) {
        problems.push(`scoreTrajectory[${index}].generation not finite`);
      }
      if (!isFiniteNumber(s.elapsedMs) || (s.elapsedMs as number) < 0) {
        problems.push(`scoreTrajectory[${index}].elapsedMs invalid`);
      }
      if (!isFiniteNumber(s.bestFitness)) {
        problems.push(`scoreTrajectory[${index}].bestFitness not finite`);
      }
      if (!isFiniteNumber(s.averageFitness)) {
        problems.push(`scoreTrajectory[${index}].averageFitness not finite`);
      }
    });
  }

  for (
    const key of [
      "initialBestFitness",
      "finalBestFitness",
      "bestFitness",
      "totalElapsedMs",
      "scorePerHour",
    ]
  ) {
    if (!isFiniteNumber(r[key])) {
      problems.push(`${key} not finite`);
    }
  }

  return problems;
}

/** Outcome of a baseline regression comparison. */
export interface BaselineComparison {
  /** `true` when no hard (deterministic outcome) regression was detected. */
  readonly passed: boolean;
  /** Hard-failure reasons — deterministic evolution-outcome regressions. */
  readonly reasons: string[];
  /**
   * Advisory warnings that do NOT fail the gate — currently the score/hour
   * drop, which is wall-clock- and machine-load-dependent and would be flaky as
   * a hard gate. Surfaced in logs/artifacts as evidence, not as a blocker.
   */
  readonly warnings: string[];
  readonly scorePerHourDropPct: number;
  readonly finalScoreDelta: number;
  /** Whether the seeded per-generation score trajectory matched the baseline. */
  readonly trajectoryMatched: boolean;
}

/** Tuning knobs for {@link compareToBaseline}. */
export interface BaselineComparisonOptions {
  /** Max allowed score/hour drop below baseline before failing (percent). */
  readonly maxScorePerHourDropPct?: number;
  /**
   * Relative tolerance for the deterministic score checks. The seeded trajectory
   * is reproducible, but tiny cross-platform float differences (e.g. `Math.tanh`)
   * can appear, so a small relative epsilon avoids false positives while still
   * catching genuine outcome regressions.
   */
  readonly scoreRelTolerance?: number;
}

/** Is `value` worse than `baseline` (lower) beyond a relative tolerance? */
function regressedBelow(
  value: number,
  baseline: number,
  relTolerance: number,
): boolean {
  const allowance = Math.abs(baseline) * relTolerance;
  return value < baseline - allowance;
}

/**
 * Compare a fresh result against a checked-in baseline trajectory.
 *
 * The **deterministic evolution outcome** — the per-generation best-fitness
 * trajectory and the final best score — is the machine-independent guardrail: a
 * change that speeds evolution up but worsens the scores it reaches is flagged
 * here (as a hard failure) regardless of how fast the CI runner is.
 *
 * Score/hour is inherently wall-clock- and therefore machine-load-dependent —
 * the same code can vary well beyond 10% between runs on the same host — so a
 * hard threshold on it would be flaky. It is reported as an advisory **warning**
 * (see `warnings`), not a blocker. Pure speed-ups that keep or improve the
 * scores never fail; genuine outcome regressions always do.
 */
export function compareToBaseline(
  result: HarnessResult,
  baseline: HarnessResult,
  options: BaselineComparisonOptions = {},
): BaselineComparison {
  const maxScorePerHourDropPct = options.maxScorePerHourDropPct ?? 10;
  const scoreRelTolerance = options.scoreRelTolerance ?? 1e-6;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Final best score must not regress (machine-independent, deterministic).
  const finalScoreDelta = result.finalBestFitness - baseline.finalBestFitness;
  if (
    regressedBelow(
      result.finalBestFitness,
      baseline.finalBestFitness,
      scoreRelTolerance,
    )
  ) {
    reasons.push(
      `final best score regressed by ${Math.abs(finalScoreDelta)}: ` +
        `${result.finalBestFitness} vs baseline ${baseline.finalBestFitness}`,
    );
  }

  // 2. The seeded per-generation best-fitness trajectory must not regress.
  let trajectoryMatched = true;
  const n = Math.min(
    result.scoreTrajectory.length,
    baseline.scoreTrajectory.length,
  );
  if (result.scoreTrajectory.length !== baseline.scoreTrajectory.length) {
    trajectoryMatched = false;
    reasons.push(
      `trajectory length changed: ${result.scoreTrajectory.length} vs ` +
        `baseline ${baseline.scoreTrajectory.length} generations`,
    );
  }
  for (let i = 0; i < n; i++) {
    const got = result.scoreTrajectory[i].bestFitness;
    const want = baseline.scoreTrajectory[i].bestFitness;
    if (regressedBelow(got, want, scoreRelTolerance)) {
      trajectoryMatched = false;
      reasons.push(
        `generation ${
          result.scoreTrajectory[i].generation
        } best fitness regressed: ${got} vs baseline ${want}`,
      );
    }
  }

  // 3. Score/hour drop (advisory warning — wall-clock- and machine-dependent).
  const baseScorePerHour = baseline.scorePerHour;
  const scorePerHourDropPct = baseScorePerHour !== 0
    ? ((baseScorePerHour - result.scorePerHour) / Math.abs(baseScorePerHour)) *
      100
    : 0;
  if (scorePerHourDropPct > maxScorePerHourDropPct) {
    warnings.push(
      `score/hour dropped ${scorePerHourDropPct.toFixed(2)}% below baseline ` +
        `(advisory limit ${maxScorePerHourDropPct}%): ${result.scorePerHour} ` +
        `vs ${baseScorePerHour} — wall-clock-dependent, not a hard failure`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    warnings,
    scorePerHourDropPct,
    finalScoreDelta,
    trajectoryMatched,
  };
}

// ──────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): {
  config: HarnessConfig;
  out?: string;
  baseline?: string;
} {
  const map = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      map.set(match[1], match[2]);
    } else if (arg.startsWith("--")) {
      map.set(arg.slice(2), "true");
    }
  }

  const num = (key: string): number | undefined => {
    const raw = map.get(key);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${key} must be a finite number, got '${raw}'`);
    }
    return value;
  };

  const scaleRaw = map.get("scale");
  if (
    scaleRaw !== undefined &&
    scaleRaw !== "default" && scaleRaw !== "grq-cluster" &&
    scaleRaw !== "grq-3397"
  ) {
    throw new Error(
      `--scale must be one of default|grq-cluster|grq-3397, got '${scaleRaw}'`,
    );
  }

  const config = withConfigDefaults({
    seed: num("seed"),
    scale: scaleRaw as HarnessConfig["scale"] | undefined,
    inputCount: num("inputs"),
    outputCount: num("outputs"),
    sampleCount: num("samples"),
    populationSize: num("population"),
    maxGenerations: num("max-generations"),
    timeBudgetMs: num("time-budget-ms"),
    threads: num("threads"),
    trainPerGen: num("train-per-gen"),
    discoverySampleRate: num("discovery-sample-rate"),
    trainDataPath: map.get("train-data"),
  });

  return { config, out: map.get("out"), baseline: map.get("baseline") };
}

async function main(args: string[]): Promise<number> {
  const { config, out, baseline } = parseArgs(args);

  const result = await runScorePerHourHarness(config);

  const problems = validateHarnessResult(
    JSON.parse(JSON.stringify(result)),
  );
  if (problems.length > 0) {
    console.error("Harness output failed schema validation:");
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  const json = JSON.stringify(result, null, 2);
  if (out) {
    await Deno.writeTextFile(out, json + "\n");
    console.error(`Wrote trajectory to ${out}`);
  } else {
    console.log(json);
  }

  console.error(
    `\nTopology: ${result.topology.neurons} neurons, ` +
      `${result.topology.synapses} synapses, ${result.topology.inputs} inputs`,
  );
  console.error(
    `Generations: ${result.scoreTrajectory.length}, ` +
      `best fitness: ${result.bestFitness}, ` +
      `score/hour: ${result.scorePerHour.toFixed(6)}`,
  );

  if (baseline) {
    const baselineResult = JSON.parse(
      await Deno.readTextFile(baseline),
    ) as HarnessResult;
    const comparison = compareToBaseline(result, baselineResult);
    for (const warning of comparison.warnings) {
      console.error(`  ⚠ ${warning}`);
    }
    if (!comparison.passed) {
      console.error("\nBASELINE REGRESSION DETECTED:");
      for (const reason of comparison.reasons) {
        console.error(`  - ${reason}`);
      }
      return 1;
    }
    console.error(
      `\nBaseline check passed (evolution outcome preserved; score/hour drop ` +
        `${comparison.scorePerHourDropPct.toFixed(2)}%, ` +
        `final score delta ${comparison.finalScoreDelta}).`,
    );
  }

  return 0;
}

if (import.meta.main) {
  main(Deno.args)
    .then((code) => {
      if (code !== 0) Deno.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    });
}
