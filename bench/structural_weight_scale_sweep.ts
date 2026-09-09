/**
 * Issue #3970 — same-seed sweep over `structuralWeightScale`.
 *
 * The identity-initialisation change adds two knobs (`structuralWeightScale`,
 * `structuralNewbornGraceRounds`) whose defaults reproduce the historical
 * behaviour exactly. Whether a *reduced* scale is worth switching on is an
 * empirical question, and the issue names the four numbers that answer it:
 *
 *   1. **Structural-mutation acceptance rate** — does a near-identity newborn
 *      actually survive selection more often than a ±0.5 kick?
 *   2. **Post-training outward-weight distribution** of the neurons added — the
 *      honest failure mode is "accepted but useless". If the outward weights
 *      stay at their ~1e-5 birth scale after the gradient step, the operator is
 *      inflating the creature with dead structure and that is a *negative*
 *      result, not a win.
 *   3. **Hidden-neuron growth** — a rise in accepted structural mutations that
 *      comes with runaway growth is a regression.
 *   4. **Score per wall-clock hour** — the milestone's success metric.
 *
 * Two measurements, because no single one yields all four:
 *
 * - A **probe** (`runStructuralProbe`) drives `AddNeuron` directly on a fixed
 *   parent under a fixed seed, scores the offspring the way selection would,
 *   runs the gradient step the issue's payoff argument depends on, and reads
 *   the newborn's outward weight afterwards. It answers (1) and (2), is pure
 *   in-process arithmetic, and is byte-reproducible.
 * - An **evolution point** (`runEvolutionPoint`) runs the real seeded evolution
 *   loop and records the score-vs-time curve plus mean topology per generation.
 *   It answers (3) and (4).
 *
 * Same-seed by construction: every scale re-seeds the global RNG from the same
 * base seed before each trial, so trial *t* picks the same mutation site at
 * every scale and only the outward weight differs. The scale list always
 * includes `1` (the shipped default), which is the baseline row.
 *
 * Silent-failure guard (Issue #3234): an empty scale list, a duplicate scale, a
 * probe that never mutated, or a missing baseline row throws rather than
 * producing a table that looks complete.
 *
 * CLI:
 *   deno task bench:structural-scale -- \
 *     --scales=1,0.1,0.001 --trials=40 --generations=6 --out=sweep.json
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { MSE } from "@costs/MSE.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  createSeededRng as createNeatSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** Machine-readable output schema version. Bump on breaking shape changes. */
export const SCALE_SWEEP_SCHEMA_VERSION = 1 as const;

/** The shipped default scale — the baseline every other row is measured against. */
export const BASELINE_SCALE = 1;

/** Configuration for one sweep run. Serialised whole into the output. */
export interface ScaleSweepConfig {
  /** Seed for the topology, the data, and the per-trial mutation RNG. */
  readonly seed: number;
  /** Outward weight scales to compare. Must contain {@link BASELINE_SCALE}. */
  readonly scales: readonly number[];
  /** `structuralNewbornGraceRounds` applied to every non-baseline scale. */
  readonly graceRounds: number;
  /** Number of inputs. */
  readonly inputCount: number;
  /** Hidden neurons in the parent creature. */
  readonly hiddenCount: number;
  /** Number of outputs. */
  readonly outputCount: number;
  /** Number of synthetic training samples. */
  readonly sampleCount: number;
  /**
   * Backprop epochs used to tune the parent before any mutation. The issue's
   * premise is a creature *already tuned to fifth-decimal margins*; an untuned
   * parent would make every structural mutation look harmless.
   */
  readonly parentTrainingIterations: number;
  /** `AddNeuron` trials per scale in the probe. */
  readonly trials: number;
  /** Backprop epochs applied to each mutated offspring before reading weights. */
  readonly trainingSteps: number;
  /** Growth cost used when scoring offspring — matches the production default. */
  readonly growthCost: number;
  /** Population size for the evolution points. */
  readonly populationSize: number;
  /** Generation cap for the evolution points. `0` skips the evolution stage. */
  readonly generations: number;
  /** Wall-clock budget per evolution point, in milliseconds. */
  readonly timeBudgetMs: number;
}

/** Distribution summary of a set of magnitudes. All fields are finite. */
export interface MagnitudeSummary {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
  /** Geometric mean — the right average for values spanning many decades. */
  readonly geometricMean: number;
}

/** Probe result for a single scale. */
export interface ProbeResult {
  readonly scale: number;
  /** Trials that produced a new neuron (a refused mutation is not a trial). */
  readonly mutations: number;
  /**
   * Fraction of mutations whose offspring's **error** was no worse than its
   * parent's, within {@link NEUTRALITY_TOLERANCE} — the ResNet claim measured
   * directly: "adding a block cannot make the model worse". Growth cost is
   * deliberately excluded, because growth cost is not a behavioural effect.
   */
  readonly behaviourNeutralAtBirth: number;
  /**
   * Median of `(childError - parentError) / parentError` across the mutations
   * — how large a perturbation the operator actually is, with no threshold to
   * argue about. A true `x + εF(x)` construction drives this to ~0.
   */
  readonly medianErrorDelta: number;
  /**
   * Fraction of mutations whose offspring **scored** at or above its parent —
   * what selection actually does, growth cost included. The issue predicts
   * this stays below {@link ProbeResult.behaviourNeutralAtBirth} for a reduced
   * scale: a behaviour-neutral newborn still pays `~1.2 × growthCost`, so it
   * lands near-tied rather than ahead.
   */
  readonly acceptanceRateAtBirth: number;
  /** The same fraction measured after {@link ScaleSweepConfig.trainingSteps}. */
  readonly acceptanceRateAfterTraining: number;
  /** Outward-weight magnitudes of the newborns at birth. */
  readonly outwardAtBirth: MagnitudeSummary;
  /** Outward-weight magnitudes of the same newborns after training. */
  readonly outwardAfterTraining: MagnitudeSummary;
  /**
   * Fraction of newborns whose outward magnitude grew by at least
   * {@link ESCAPE_FACTOR} during training — the "did the gradient step give it
   * a job?" number the issue's failure-detection section asks for.
   */
  readonly escapedBirthScale: number;
}

/** Evolution-loop result for a single scale. */
export interface EvolutionResult {
  readonly scale: number;
  readonly generations: number;
  readonly initialBestScore: number;
  readonly finalBestScore: number;
  readonly totalElapsedMs: number;
  /** `(finalBest - initialBest) / hours`. `0` when no measurable time passed. */
  readonly scorePerHour: number;
  /** Mean hidden-neuron count across the population at the first generation. */
  readonly initialHiddenNeurons: number;
  /** The same at the last generation. */
  readonly finalHiddenNeurons: number;
  /** Mean synapse count across the population at the last generation. */
  readonly finalSynapses: number;
}

/** One fully-measured row of the comparison table. */
export interface ScaleSweepEntry {
  readonly scale: number;
  readonly label: string;
  readonly probe: ProbeResult;
  readonly evolution: EvolutionResult | null;
}

/** Full machine-readable sweep output. */
export interface ScaleSweepReport {
  readonly schemaVersion: number;
  readonly config: ScaleSweepConfig;
  readonly topology: {
    readonly neurons: number;
    readonly synapses: number;
    readonly inputs: number;
  };
  /**
   * Mean squared error of the tuned parent on the task. Reported so a reader
   * can judge how tuned "tuned" was — the whole comparison is meaningless
   * against a parent that had not converged.
   */
  readonly parentError: number;
  readonly entries: readonly ScaleSweepEntry[];
}

/**
 * Growth factor an outward weight must reach during training before we count
 * the newborn as having been given a job. Ten times its birth magnitude is a
 * decade — comfortably outside gradient noise, and the threshold at which a
 * near-identity branch stops being near-identity.
 */
export const ESCAPE_FACTOR = 10;

/**
 * Relative error tolerance under which an offspring counts as behaviour-neutral.
 *
 * A genuinely identity-initialised newborn leaves the error *bit-for-bit* the
 * same only in exact arithmetic; in float it lands a few ULP either side, so a
 * strict `<=` would score a perfect no-op at a coin-flip 50%. `1e-6` is far
 * below any perturbation worth calling behavioural and far above float noise.
 */
export const NEUTRALITY_TOLERANCE = 1e-6;

/** Fill in the defaults for a partial config (used by the CLI and tests). */
export function withScaleSweepDefaults(
  partial: Partial<ScaleSweepConfig> = {},
): ScaleSweepConfig {
  return {
    seed: partial.seed ?? 3970,
    scales: partial.scales ?? [1, 0.1, 0.001],
    graceRounds: partial.graceRounds ?? 1,
    inputCount: partial.inputCount ?? 8,
    hiddenCount: partial.hiddenCount ?? 24,
    outputCount: partial.outputCount ?? 2,
    sampleCount: partial.sampleCount ?? 64,
    parentTrainingIterations: partial.parentTrainingIterations ?? 200,
    trials: partial.trials ?? 40,
    trainingSteps: partial.trainingSteps ?? 20,
    growthCost: partial.growthCost ?? 1e-7,
    populationSize: partial.populationSize ?? 10,
    generations: partial.generations ?? 6,
    timeBudgetMs: partial.timeBudgetMs ?? 10 * 60_000,
  };
}

/**
 * Validate a config, failing loud on anything that would produce a table that
 * looks complete but is not (Issue #3234).
 *
 * @throws {Error} When the scale list is empty, holds a duplicate or a
 *   non-positive value, omits the baseline, or the trial count is not positive.
 */
export function assertValidScaleSweepConfig(config: ScaleSweepConfig): void {
  if (config.scales.length < 3) {
    throw new Error(
      `A structuralWeightScale sweep needs at least 3 scales to be a curve ` +
        `rather than an A/B point, got ${config.scales.length} (Issue #3970)`,
    );
  }
  const seen = new Set<number>();
  for (const scale of config.scales) {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(
        `structuralWeightScale must be finite and greater than zero, got ${scale}`,
      );
    }
    if (seen.has(scale)) {
      throw new Error(
        `Duplicate scale ${scale} — every row must be a distinct config ` +
          "(Issue #3234)",
      );
    }
    seen.add(scale);
  }
  if (!seen.has(BASELINE_SCALE)) {
    throw new Error(
      `The sweep must include the shipped default scale ${BASELINE_SCALE} as ` +
        "its baseline row, otherwise no row is comparable to current behaviour",
    );
  }
  if (!Number.isInteger(config.trials) || config.trials < 1) {
    throw new Error(`trials must be a positive integer, got ${config.trials}`);
  }
  if (!Number.isInteger(config.trainingSteps) || config.trainingSteps < 1) {
    throw new Error(
      `trainingSteps must be a positive integer, got ${config.trainingSteps}`,
    );
  }
}

/**
 * Summarise a set of magnitudes. Non-finite and negative inputs are rejected
 * rather than silently skewing the distribution.
 *
 * @param values - Weight magnitudes; may be empty.
 * @returns The summary; all-zero when `values` is empty.
 */
export function summariseMagnitudes(
  values: readonly number[],
): MagnitudeSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, median: 0, max: 0, geometricMean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  let logSum = 0;
  for (const value of sorted) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `Weight magnitude must be finite and non-negative, got ${value}`,
      );
    }
    // A zero magnitude would send the geometric mean to zero; the operator's
    // one-plank floor means it cannot occur, so treat it as the floor.
    logSum += Math.log(Math.max(value, Number.MIN_VALUE));
  }
  return {
    count: sorted.length,
    min: sorted[0],
    median: median(sorted),
    max: sorted[sorted.length - 1],
    geometricMean: Math.exp(logSum / sorted.length),
  };
}

/**
 * Median of a list of finite numbers. Returns `0` for an empty list — the
 * callers only ever pass a list they have already proven non-empty.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Short, stable row label for a scale. */
export function scaleLabel(scale: number): string {
  if (scale === BASELINE_SCALE) return "scale1 (baseline)";
  return `scale${scale}`;
}

/**
 * Mean squared error of a creature over a dataset.
 *
 * Exported for #3973's null-comparison harness, which measures the same thing on
 * the same production path rather than keeping a second copy.
 */
export function datasetError(
  creature: Creature,
  data: readonly DataRecordInterface[],
): number {
  const cost = new MSE();
  let total = 0;
  for (const record of data) {
    const output = creature.activate(record.input);
    total += cost.calculate(record.output, output);
  }
  creature.clearState();
  return total / data.length;
}

/** Score a creature exactly the way selection would. */
function scoreCreature(
  creature: Creature,
  data: readonly DataRecordInterface[],
  growthCost: number,
): number {
  creature.invalidateScoreCache();
  return calculateScore(creature, datasetError(creature, data), growthCost);
}

/**
 * Run `iterations` epochs of the production backprop path over the dataset.
 *
 * Deliberately `trainDir` — the same entry point the evolution loop's
 * `trainPerGen` uses — so "after the gradient step" in the report means what it
 * means in production, not what a bespoke propagate loop would have meant.
 */
export function trainCreature(
  creature: Creature,
  data: readonly DataRecordInterface[],
  iterations: number,
): void {
  const dataDir = makeDataDir(data as DataRecordInterface[], data.length, {
    input: creature.input,
    output: creature.output,
  });
  try {
    trainDir(creature, dataDir, { iterations, targetError: 0 }, new MSE());
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
  creature.clearState();
  creature.invalidateScoreCache();
}

/**
 * Largest outward-synapse magnitude of the neuron with the given UUID.
 *
 * @throws {Error} When the neuron is gone. A missing newborn is a real fault —
 *   returning `0` would fold it into the weight distribution as "an outward
 *   weight of zero" and produce a complete-looking, wrong evidence row
 *   (Issue #3234).
 */
function outwardMagnitude(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  if (!neuron) {
    throw new Error(
      `Newborn ${uuid} is no longer in the creature — refusing to record a ` +
        "zero magnitude for a neuron that vanished (Issue #3234)",
    );
  }
  let max = 0;
  for (const synapse of creature.outwardConnections(neuron.index)) {
    const magnitude = Math.abs(synapse.weight);
    if (magnitude > max) max = magnitude;
  }
  return max;
}

/**
 * Drive `AddNeuron` at one scale on a fixed parent and measure whether the
 * offspring survives selection, and whether the gradient step then gives its
 * new structure a job.
 *
 * Same-seed: trial *t* re-seeds the global RNG from `seed + t`, so every scale
 * sees the same mutation sites in the same order.
 *
 * @throws {Error} When no trial produced a mutation — an empty probe reported
 *   as a clean result would mask a broken operator (Issue #3234).
 */
export function runStructuralProbe(
  parentExport: CreatureExport,
  data: readonly DataRecordInterface[],
  scale: number,
  config: ScaleSweepConfig,
): ProbeResult {
  const previousRng = getRandomNumberGenerator();
  const parent = Creature.fromJSON(parentExport);
  const parentError = datasetError(parent, data);
  const parentScore = scoreCreature(parent, data, config.growthCost);

  const birthMagnitudes: number[] = [];
  const errorDeltas: number[] = [];
  const trainedMagnitudes: number[] = [];
  let behaviourNeutral = 0;
  let acceptedAtBirth = 0;
  let acceptedAfterTraining = 0;
  let escaped = 0;
  let mutations = 0;

  try {
    // The control: the same parent given the same training the offspring get,
    // so "accepted after training" compares like with like.
    const trainedParent = Creature.fromJSON(parentExport);
    setRandomNumberGenerator(createNeatSeededRng(config.seed));
    trainCreature(trainedParent, data, config.trainingSteps);
    const trainedParentScore = scoreCreature(
      trainedParent,
      data,
      config.growthCost,
    );

    for (let trial = 0; trial < config.trials; trial++) {
      setRandomNumberGenerator(createNeatSeededRng(config.seed + trial));
      const child = Creature.fromJSON(parentExport);
      const before = new Set(child.neurons.map((n) => n.uuid));
      const operator = new AddNeuron(child, {
        structuralWeightScale: scale,
        structuralNewbornGraceRounds: scale === BASELINE_SCALE
          ? 0
          : config.graceRounds,
      });
      // A refused mutation is not a trial — the operator declined, which is
      // ordinary. A mutation that *reports success* without leaving a findable
      // new neuron is a broken operator, so that case throws instead.
      if (!operator.mutate()) continue;
      const newborn = child.neurons.find((n) =>
        n.type === "hidden" && n.uuid !== undefined && !before.has(n.uuid)
      );
      if (!newborn?.uuid) {
        throw new Error(
          `AddNeuron reported success on trial ${trial} at scale ${scale} but ` +
            "added no findable hidden neuron (Issue #3234)",
        );
      }
      mutations++;

      const birth = outwardMagnitude(child, newborn.uuid);
      birthMagnitudes.push(birth);
      const childError = datasetError(child, data);
      errorDeltas.push(
        parentError > 0 ? (childError - parentError) / parentError : 0,
      );
      if (childError <= parentError * (1 + NEUTRALITY_TOLERANCE)) {
        behaviourNeutral++;
      }
      if (scoreCreature(child, data, config.growthCost) >= parentScore) {
        acceptedAtBirth++;
      }

      // Re-seed before training too: `trainDir` draws from the global RNG for
      // its sample order, so without this the same offspring would train
      // differently on every run and the post-training columns would be noise.
      setRandomNumberGenerator(createNeatSeededRng(config.seed + trial));
      trainCreature(child, data, config.trainingSteps);
      const trained = outwardMagnitude(child, newborn.uuid);
      trainedMagnitudes.push(trained);
      if (trained >= birth * ESCAPE_FACTOR) escaped++;
      if (
        scoreCreature(child, data, config.growthCost) >= trainedParentScore
      ) {
        acceptedAfterTraining++;
      }
    }
  } finally {
    setRandomNumberGenerator(previousRng);
  }

  if (mutations === 0) {
    throw new Error(
      `AddNeuron produced no mutation in ${config.trials} trials at scale ` +
        `${scale} — refusing to report an empty probe as a result (Issue #3234)`,
    );
  }

  return {
    scale,
    mutations,
    behaviourNeutralAtBirth: behaviourNeutral / mutations,
    medianErrorDelta: median(errorDeltas),
    acceptanceRateAtBirth: acceptedAtBirth / mutations,
    acceptanceRateAfterTraining: acceptedAfterTraining / mutations,
    outwardAtBirth: summariseMagnitudes(birthMagnitudes),
    outwardAfterTraining: summariseMagnitudes(trainedMagnitudes),
    escapedBirthScale: escaped / mutations,
  };
}

/**
 * Run the real seeded evolution loop at one scale and record the score-vs-time
 * curve plus the mean topology per generation.
 *
 * @throws {Error} When the run completed no generation (Issue #3234).
 */
export async function runEvolutionPoint(
  parentExport: CreatureExport,
  data: readonly DataRecordInterface[],
  scale: number,
  config: ScaleSweepConfig,
  now: () => number = () => performance.now(),
): Promise<EvolutionResult> {
  const fixedNeurons = config.inputCount + config.outputCount;
  const samples: {
    bestScore: number;
    hidden: number;
    synapses: number;
  }[] = [];
  const start = now();

  const options: NeatOptions = {
    iterations: config.generations,
    timeoutMinutes: config.timeBudgetMs / 60_000,
    targetError: 0,
    populationSize: config.populationSize,
    threads: 1,
    seed: config.seed,
    trainPerGen: 1,
    discoverySampleRate: -1,
    costOfGrowth: config.growthCost,
    structuralWeightScale: scale,
    structuralNewbornGraceRounds: scale === BASELINE_SCALE
      ? 0
      : config.graceRounds,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind !== "generation_complete") return;
      samples.push({
        bestScore: event.bestFitness,
        hidden: Math.max(event.averageNeurons - fixedNeurons, 0),
        synapses: event.averageSynapses,
      });
    },
  };

  const creature = Creature.fromJSON(parentExport);
  await creature.evolveDataSet(data as DataRecordInterface[], options);
  const totalElapsedMs = now() - start;

  if (samples.length === 0) {
    throw new Error(
      `The evolution run at scale ${scale} completed no generation within its ` +
        "budget — refusing to emit an empty row (Issue #3234)",
    );
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const hours = totalElapsedMs / 3_600_000;
  return {
    scale,
    generations: samples.length,
    initialBestScore: first.bestScore,
    finalBestScore: last.bestScore,
    totalElapsedMs,
    scorePerHour: hours > 0 ? (last.bestScore - first.bestScore) / hours : 0,
    initialHiddenNeurons: first.hidden,
    finalHiddenNeurons: last.hidden,
    finalSynapses: last.synapses,
  };
}

/** Format a number compactly for the Markdown tables. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(2);
  return n.toFixed(4);
}

/**
 * Format a 0..1 fraction as a percentage.
 *
 * Exported for #3973's null-comparison harness, whose zero-gradient columns are
 * fractions of exactly the same kind.
 */
export function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Render the sweep as the GitHub-flavoured Markdown table the issue asks for:
 * one row per scale, carrying all four measurements.
 *
 * @throws {Error} When the baseline row is absent — a table with nothing to
 *   compare against is not evidence (Issue #3234).
 */
export function formatScaleSweepMarkdown(
  entries: readonly ScaleSweepEntry[],
): string {
  if (!entries.some((e) => e.scale === BASELINE_SCALE)) {
    throw new Error(
      `No baseline row (scale ${BASELINE_SCALE}) in the sweep — nothing to ` +
        "compare the reduced scales against (Issue #3234)",
    );
  }
  const ordered = [...entries].sort((a, b) => b.scale - a.scale);

  const probeHeader = "| Scale | Mutations | Behaviour-neutral @ birth | " +
    "Median error delta | Accept @ birth | Accept post-train | " +
    "Outward @ birth (median) | Outward post-train (median) | Grew ≥10× |";
  const probeSep =
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const probeRows = ordered.map((e) =>
    `| ${e.label} | ${e.probe.mutations} | ${
      pct(e.probe.behaviourNeutralAtBirth)
    } | ${fmt(e.probe.medianErrorDelta)} | ${
      pct(e.probe.acceptanceRateAtBirth)
    } | ${pct(e.probe.acceptanceRateAfterTraining)} | ${
      fmt(e.probe.outwardAtBirth.median)
    } | ${fmt(e.probe.outwardAfterTraining.median)} | ${
      pct(e.probe.escapedBirthScale)
    } |`
  );

  const evoRows = ordered.filter((e) => e.evolution !== null).map((e) => {
    const evo = e.evolution!;
    return `| ${e.label} | ${evo.generations} | ${fmt(evo.finalBestScore)} | ${
      fmt(evo.scorePerHour)
    } | ${evo.initialHiddenNeurons.toFixed(1)} → ${
      evo.finalHiddenNeurons.toFixed(1)
    } | ${evo.finalSynapses.toFixed(1)} |`;
  });

  const sections = [
    "### Structural-mutation probe (same seed, same mutation sites)",
    "",
    probeHeader,
    probeSep,
    ...probeRows,
  ];
  if (evoRows.length > 0) {
    sections.push(
      "",
      "### Evolution loop",
      "",
      "| Scale | Gens | Final best score | Score/hour | Hidden neurons | Synapses |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...evoRows,
    );
  }
  return sections.join("\n");
}

/**
 * Deterministic seeded PRNG (mulberry32) — the sweep's own, so a run is
 * reproducible without touching the engine's global RNG.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a well-conditioned single-hidden-layer parent creature.
 *
 * Deliberately not the `ProductionScaleCreature` generator: that one builds a
 * dense, randomly-wired topology whose outputs diverge to ~1e31 on random
 * targets, so backprop rolls its own step back and *nothing* trains. A tuned
 * parent is the whole premise of the issue, and it needs a topology that can
 * actually be tuned. `TANH` hidden units with fan-in-scaled weights give that.
 */
export function buildParentCreature(
  config: ScaleSweepConfig,
  rng: () => number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const inwardScale = 1 / Math.sqrt(config.inputCount);
  const outwardScale = 1 / Math.sqrt(config.hiddenCount);

  for (let h = 0; h < config.hiddenCount; h++) {
    const uuid = `hidden-${h}`;
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: (rng() * 2 - 1) * 0.1,
    });
    for (let i = 0; i < config.inputCount; i++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: uuid,
        weight: (rng() * 2 - 1) * inwardScale,
      });
    }
  }
  for (let o = 0; o < config.outputCount; o++) {
    const uuid = `output-${o}`;
    neurons.push({
      type: "output",
      uuid,
      squash: "IDENTITY",
      bias: (rng() * 2 - 1) * 0.1,
    });
    for (let h = 0; h < config.hiddenCount; h++) {
      synapses.push({
        fromUUID: `hidden-${h}`,
        toUUID: uuid,
        weight: (rng() * 2 - 1) * outwardScale,
      });
    }
  }
  return {
    neurons,
    synapses,
    input: config.inputCount,
    output: config.outputCount,
  };
}

/**
 * Build a learnable-but-not-trivial regression task: each output is a fixed
 * smooth nonlinear function (`tanh` of a fan-in-scaled random projection) of
 * the inputs. Low-frequency enough that the parent tunes down to a small
 * residual — which is the regime the issue describes — but not so trivial that
 * there is nothing left for a residual branch to learn.
 */
export function buildTask(
  config: ScaleSweepConfig,
  rng: () => number,
): DataRecordInterface[] {
  const projections: number[][] = [];
  for (let o = 0; o < config.outputCount; o++) {
    const row: number[] = [];
    for (let i = 0; i < config.inputCount; i++) {
      row.push((rng() * 2 - 1) / Math.sqrt(config.inputCount));
    }
    projections.push(row);
  }

  const records: DataRecordInterface[] = [];
  for (let s = 0; s < config.sampleCount; s++) {
    const input = new Float32Array(config.inputCount);
    for (let i = 0; i < config.inputCount; i++) input[i] = rng() * 2 - 1;
    const output = new Float32Array(config.outputCount);
    for (let o = 0; o < config.outputCount; o++) {
      let dot = 0;
      const row = projections[o];
      for (let i = 0; i < config.inputCount; i++) dot += row[i] * input[i];
      output[o] = Math.tanh(dot * 2) * 0.5;
    }
    records.push({ input, output });
  }
  return records;
}

/**
 * Run the whole sweep: the probe at every scale, then — when
 * `generations > 0` — an evolution point at every scale.
 *
 * Sequential by design: concurrent points would contend for the same cores and
 * distort the score-per-hour timings.
 */
export async function runScaleSweep(
  config: ScaleSweepConfig,
): Promise<ScaleSweepReport> {
  assertValidScaleSweepConfig(config);

  const data = buildTask(config, createSeededRng(config.seed + 1_000));

  // Tune the parent first — an untuned parent would make every structural
  // mutation look harmless and the whole comparison meaningless.
  const parent = Creature.fromJSON(
    buildParentCreature(config, createSeededRng(config.seed)),
  );
  const previousRng = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(createNeatSeededRng(config.seed));
    trainCreature(parent, data, config.parentTrainingIterations);
  } finally {
    setRandomNumberGenerator(previousRng);
  }
  const parentError = datasetError(parent, data);
  const parentExport = parent.exportJSON();

  const entries: ScaleSweepEntry[] = [];
  for (const scale of config.scales) {
    const probe = runStructuralProbe(parentExport, data, scale, config);
    let evolution: EvolutionResult | null = null;
    if (config.generations > 0) {
      // deno-lint-ignore no-await-in-loop
      evolution = await runEvolutionPoint(parentExport, data, scale, config);
    }
    entries.push({ scale, label: scaleLabel(scale), probe, evolution });
  }

  return {
    schemaVersion: SCALE_SWEEP_SCHEMA_VERSION,
    config,
    topology: {
      neurons: parentExport.neurons.length,
      synapses: parentExport.synapses.length,
      inputs: parentExport.input,
    },
    parentError,
    entries,
  };
}

// ──────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────

/** Parse `--scales=1,0.1,0.001` into a list of finite positive numbers. */
export function parseScales(raw: string): number[] {
  const values = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`'${s}' is not a finite scale greater than zero`);
      }
      return n;
    });
  if (values.length === 0) {
    throw new Error("--scales must list at least one scale");
  }
  return values;
}

if (import.meta.main) {
  const args = new Map<string, string>();
  for (const arg of Deno.args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args.set(match[1], match[2]);
  }
  const num = (key: string): number | undefined => {
    const raw = args.get(key);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${key} must be a finite number, got '${raw}'`);
    }
    return value;
  };

  const scalesArg = args.get("scales");
  const config = withScaleSweepDefaults({
    seed: num("seed"),
    scales: scalesArg ? parseScales(scalesArg) : undefined,
    graceRounds: num("grace-rounds"),
    inputCount: num("inputs"),
    outputCount: num("outputs"),
    sampleCount: num("samples"),
    trials: num("trials"),
    trainingSteps: num("training-steps"),
    growthCost: num("growth-cost"),
    populationSize: num("population"),
    generations: num("generations"),
    timeBudgetMs: num("time-budget-ms"),
  });

  const report = await runScaleSweep(config);
  const markdown = formatScaleSweepMarkdown(report.entries);
  console.info(markdown);

  const out = args.get("out");
  if (out) {
    await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
    console.info(`\nWrote ${out}`);
  }
}
