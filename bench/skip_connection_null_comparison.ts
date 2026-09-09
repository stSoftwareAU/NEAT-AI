/**
 * The null comparison for the targeted skip-connection operator (Issue #3973).
 *
 * The operator's claim is not "a synapse was added" — it is that a synapse added
 * *where the deep chain is* restores gradient to everything upstream of that
 * chain, and that a synapse added anywhere does not. So every run measures three
 * arms on the same creature and the same seed:
 *
 * - **baseline** — nothing added.
 * - **skip** — `n` bypasses from `AddSkipConnection`.
 * - **random** — `n` connections from `AddConnection`, drawn uniformly, at the
 *   same weight scale. This is the null: if targeted skips do not beat it, the
 *   targeting is worthless and the honest outcome is to say so.
 *
 * Each arm reports #3972's gradient depth profile — the pooled zero-gradient
 * fraction upstream of the chain, and the chain's own aggregate — plus, when the
 * arm is trained, the post-training weight of every synapse the arm added. A
 * skip synapse sitting at its initialisation scale after training is a bypass
 * that never found a job: cost without function, a negative result to report
 * rather than tune away.
 *
 * ```bash
 * # Synthetic tuned parent with a 12-neuron single-file tail, trained.
 * deno task bench:skip-null -- --skips 3 --seed 3973
 *
 * # #3972's own creature, profile only (2,500 neurons — no training arm).
 * deno task bench:skip-null -- --creature test/data/grq-23-forests-constants.json \
 *   --profile-only true --samples 16 --skips 4
 * ```
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { MSE } from "@costs/MSE.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { AddSkipConnection } from "@mutate/AddSkipConnection.ts";
import {
  type GradientDepthProfile,
  probeGradientDepth,
} from "@propagate/GradientDepthProbe.ts";
import { longestSerialChain } from "@propagate/SerialChains.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  numericFlag,
  parseFlags,
  syntheticObservations,
} from "../scripts/gradientDepthReport.ts";

/** Which arm produced a row. */
export type SkipArm = "baseline" | "skip" | "random";

/** Everything one run needs. */
export interface SkipNullConfig {
  /** Creature JSON to measure, or `undefined` for the synthetic parent. */
  creaturePath?: string;
  /** Synapses each non-baseline arm adds. */
  skips: number;
  /** Seed for the parent, the task, the mutations and the probe samples. */
  seed: number;
  /** Probe samples per arm. */
  samples: number;
  /** Backprop epochs per arm; `0` (or `profileOnly`) trains nothing. */
  iterations: number;
  /** Weight scale both arms initialise their new synapses at (#3970). */
  weightScale: number;
  /** Shortest serial run the skip arm will bypass. */
  minRunLength: number;
  /** Hidden neurons in the synthetic parent's single-file tail. */
  runLength: number;
  /** Depth-1 breadth in the synthetic parent — where a random draw can land. */
  width: number;
  /** Inputs of the synthetic parent. */
  inputCount: number;
  /** Training records in the synthetic task. */
  sampleCount: number;
  /**
   * Half-width of the seeded probe observations. A wider range drives
   * saturating activations such as `HARD_TANH` outside their sloped window,
   * which is where an exactly-zero derivative appears at all.
   */
  observationScale: number;
  /** Skip the training arm — for creatures too large to train here. */
  profileOnly: boolean;
}

/** The defaults every flag falls back to. */
export const SKIP_NULL_DEFAULTS: SkipNullConfig = {
  skips: 3,
  seed: 3973,
  samples: 32,
  iterations: 200,
  weightScale: 0.01,
  minRunLength: 4,
  runLength: 12,
  width: 8,
  inputCount: 4,
  sampleCount: 64,
  observationScale: 1,
  profileOnly: false,
};

/** A pooled zero-gradient reading over a set of depth buckets. */
export interface ZeroGradientPool {
  /** Neuron × sample measurements pooled. */
  observations: number;
  /** Of those, how many were exactly zero. */
  zeroObservations: number;
  /** `zeroObservations / observations`, or `0` when nothing was measured. */
  zeroFraction: number;
}

/** Distribution of a set of weight magnitudes. */
export interface MagnitudeSummary {
  count: number;
  min: number;
  median: number;
  mean: number;
  max: number;
}

/** One measured arm. */
export interface SkipArmResult {
  arm: SkipArm;
  /** Synapses the arm actually added. */
  added: number;
  /** `from->to` of each added synapse, for the record. */
  edges: string[];
  /** Pooled zero-gradient reading at or above the bypassed run's entry depth. */
  upstream: ZeroGradientPool;
  /** The run's entry neuron alone — the depth bucket it is the sole member of. */
  entry: ZeroGradientPool;
  /** The longest serial chain's own aggregate, when the creature has one. */
  chain?: ZeroGradientPool;
  /** Dataset error before training, or `undefined` when not trained. */
  errorBefore?: number;
  /** Dataset error after training, or `undefined` when not trained. */
  errorAfter?: number;
  /** Added-synapse magnitudes at birth. */
  birth?: MagnitudeSummary;
  /** The same synapses after training. */
  trained?: MagnitudeSummary;
}

/** A whole run. */
export interface SkipNullReport {
  config: SkipNullConfig;
  /** Where the creature came from. */
  provenance: string;
  /** Depth of the bypassed run's entry neuron, which fixes "upstream". */
  entryDepth: number;
  /** Members of the longest serial run found. */
  runLength: number;
  arms: SkipArmResult[];
}

/** Fill in every unset field with its default. */
export function withSkipNullDefaults(
  partial: Partial<SkipNullConfig>,
): SkipNullConfig {
  const config = { ...SKIP_NULL_DEFAULTS, ...partial };
  assertValidSkipNullConfig(config);
  return config;
}

/**
 * Refuse a configuration that cannot produce a meaningful comparison.
 *
 * @throws {RangeError} On any out-of-range field.
 */
export function assertValidSkipNullConfig(config: SkipNullConfig): void {
  if (!Number.isInteger(config.skips) || config.skips < 1) {
    throw new RangeError(
      `skips must be a positive integer, got ${config.skips}`,
    );
  }
  if (!Number.isInteger(config.samples) || config.samples < 1) {
    throw new RangeError(
      `samples must be a positive integer, got ${config.samples}`,
    );
  }
  if (!Number.isInteger(config.iterations) || config.iterations < 0) {
    throw new RangeError(
      `iterations must be a non-negative integer, got ${config.iterations}`,
    );
  }
  if (!Number.isFinite(config.weightScale) || config.weightScale <= 0) {
    throw new RangeError(
      `weightScale must be greater than zero, got ${config.weightScale}`,
    );
  }
  if (!Number.isInteger(config.minRunLength) || config.minRunLength < 2) {
    throw new RangeError(
      `minRunLength must be an integer of at least 2, got ${config.minRunLength}`,
    );
  }
  if (!Number.isInteger(config.runLength) || config.runLength < 2) {
    throw new RangeError(
      `runLength must be an integer of at least 2, got ${config.runLength}`,
    );
  }
  if (
    !Number.isFinite(config.observationScale) || config.observationScale <= 0
  ) {
    throw new RangeError(
      `observationScale must be greater than zero, got ${config.observationScale}`,
    );
  }
}

/** Pool the zero-gradient readings of every bucket at or below `maxDepth`. */
export function pooledZeroGradient(
  profile: GradientDepthProfile,
  maxDepth: number,
): ZeroGradientPool {
  let observations = 0;
  let zeroObservations = 0;
  for (const bucket of profile.buckets) {
    if (bucket.depth > maxDepth) continue;
    observations += bucket.observations;
    zeroObservations += bucket.zeroObservations;
  }
  return {
    observations,
    zeroObservations,
    zeroFraction: observations === 0 ? 0 : zeroObservations / observations,
  };
}

/**
 * The single depth bucket at `depth`, as a pooled reading.
 *
 * Inside a serial run every depth holds exactly one neuron, so the bucket at
 * the run's entry depth *is* that entry neuron's own zero-gradient fraction —
 * the sharpest reading of whether the bypass restored its gradient, undiluted
 * by the thousands of neurons the pooled upstream figure covers.
 */
export function bucketZeroGradient(
  profile: GradientDepthProfile,
  depth: number,
): ZeroGradientPool {
  const bucket = profile.buckets.find((b) => b.depth === depth);
  if (!bucket) return { observations: 0, zeroObservations: 0, zeroFraction: 0 };
  return {
    observations: bucket.observations,
    zeroObservations: bucket.zeroObservations,
    zeroFraction: bucket.zeroFraction,
  };
}

/** The chain aggregate as a pooled reading, when the profile carries one. */
export function chainZeroGradient(
  profile: GradientDepthProfile,
): ZeroGradientPool | undefined {
  const aggregate = profile.serialChainProfile?.aggregate;
  if (!aggregate) return undefined;
  return {
    observations: aggregate.observations,
    zeroObservations: aggregate.zeroObservations,
    zeroFraction: aggregate.zeroFraction,
  };
}

/** Summarise a set of magnitudes; an empty set is reported as zeroes. */
export function summariseMagnitudes(
  values: readonly number[],
): MagnitudeSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, median: 0, mean: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  let total = 0;
  for (const value of sorted) total += value;
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    mean: total / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

/**
 * A parent with breadth **and** a deep single-file tail.
 *
 * Breadth is what makes the null arm a fair comparison: a uniformly drawn
 * connection has somewhere else to go. The tail alternates `TANH` with
 * `HARD_TANH`, which has an exactly-zero derivative outside `[-1, 1]` — the
 * construct #3972 blamed for the GRQ creature's zero gradient, rather than a
 * squash that merely gets small.
 */
export function buildTailParent(
  config: SkipNullConfig,
  rng: () => number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const inwardScale = 1 / Math.sqrt(config.inputCount);

  for (let w = 0; w < config.width; w++) {
    const uuid = `wide-${w}`;
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

  for (let r = 0; r < config.runLength; r++) {
    const uuid = `run-${r}`;
    neurons.push({
      type: "hidden",
      uuid,
      squash: r % 2 === 0 ? "TANH" : "HARD_TANH",
      bias: (rng() * 2 - 1) * 0.1,
    });
    synapses.push({
      fromUUID: r === 0 ? "wide-0" : `run-${r - 1}`,
      toUUID: uuid,
      weight: 0.5 + rng() * 0.5,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: (rng() * 2 - 1) * 0.1,
  });
  for (let w = 0; w < config.width; w++) {
    synapses.push({
      fromUUID: `wide-${w}`,
      toUUID: "output-0",
      weight: (rng() * 2 - 1) / Math.sqrt(config.width),
    });
  }
  synapses.push({
    fromUUID: `run-${config.runLength - 1}`,
    toUUID: "output-0",
    weight: 0.5,
  });

  return { neurons, synapses, input: config.inputCount, output: 1 };
}

/** A smooth learnable regression task over the parent's inputs. */
export function buildTask(
  config: SkipNullConfig,
  rng: () => number,
): DataRecordInterface[] {
  const projection: number[] = [];
  for (let i = 0; i < config.inputCount; i++) {
    projection.push((rng() * 2 - 1) / Math.sqrt(config.inputCount));
  }
  const records: DataRecordInterface[] = [];
  for (let s = 0; s < config.sampleCount; s++) {
    const input = new Float32Array(config.inputCount);
    let dot = 0;
    for (let i = 0; i < config.inputCount; i++) {
      input[i] = rng() * 2 - 1;
      dot += projection[i] * input[i];
    }
    const output = new Float32Array(1);
    output[0] = Math.tanh(dot * 2) * 0.5;
    records.push({ input, output });
  }
  return records;
}

/** Mean squared error of a creature over a dataset. */
function datasetError(
  creature: Creature,
  data: readonly DataRecordInterface[],
): number {
  const cost = new MSE();
  let total = 0;
  for (const record of data) {
    total += cost.calculate(record.output, creature.activate(record.input));
  }
  creature.clearState();
  return total / data.length;
}

/** Run `iterations` epochs through the production `trainDir` path. */
function trainCreature(
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

/** Key of a synapse, stable across training because indices do not move. */
function edgeKey(from: number, to: number): string {
  return `${from}->${to}`;
}

/** Every `from->to` currently in the creature. */
function edgeSet(creature: Creature): Set<string> {
  const keys = new Set<string>();
  for (const synapse of creature.synapses) {
    keys.add(edgeKey(synapse.from, synapse.to));
  }
  return keys;
}

/** Magnitudes of the named edges, in the creature's current state. */
function magnitudesOf(creature: Creature, edges: readonly string[]): number[] {
  const wanted = new Set(edges);
  const values: number[] = [];
  for (const synapse of creature.synapses) {
    if (wanted.has(edgeKey(synapse.from, synapse.to))) {
      values.push(Math.abs(synapse.weight));
    }
  }
  return values;
}

/**
 * Apply one arm's structural change, re-seeding first so every arm sees the
 * same random stream.
 *
 * @returns The edges the arm added.
 */
function applyArm(
  creature: Creature,
  arm: SkipArm,
  config: SkipNullConfig,
  count: number,
): string[] {
  if (arm === "baseline" || count < 1) return [];
  setRandomNumberGenerator(createSeededRng(config.seed + 7));
  const before = edgeSet(creature);

  const operator = arm === "skip"
    ? new AddSkipConnection(creature, {
      structuralWeightScale: config.weightScale,
      skipMinRunLength: config.minRunLength,
    })
    : new AddConnection(creature, {
      structuralWeightScale: config.weightScale,
    });

  for (let i = 0; i < count; i++) {
    if (!operator.mutate()) break;
  }

  const added: string[] = [];
  for (const key of edgeSet(creature)) {
    if (!before.has(key)) added.push(key);
  }
  return added.sort();
}

/**
 * Measure all three arms on the same parent.
 *
 * @throws {Error} When the creature has no serial run at all — there is nothing
 *   for a targeted bypass to aim at, and reporting an empty comparison as a
 *   clean result would mask that.
 */
export function runSkipNullComparison(
  parent: CreatureExport,
  provenance: string,
  config: SkipNullConfig,
  data?: readonly DataRecordInterface[],
): SkipNullReport {
  assertValidSkipNullConfig(config);

  const reference = Creature.fromJSON(parent);
  const chain = longestSerialChain(reference);
  if (!chain) {
    throw new Error(
      `${provenance} has no serial run — nothing for a targeted bypass to aim ` +
        "at, so the comparison would be vacuous",
    );
  }
  const entryDepth = chain.members[0].depth;

  const samples = syntheticObservations(
    reference.input,
    config.samples,
    config.seed,
    config.observationScale,
  );
  const train = !config.profileOnly && config.iterations > 0 &&
    data !== undefined;

  // The skip arm runs first, and the null arm is matched to what it actually
  // added. A run with one consumer accepts exactly one bypass, so asking for
  // three would otherwise compare one targeted synapse against three random
  // ones and flatter the null.
  const arms: SkipArmResult[] = [];
  let matchedCount = config.skips;
  for (const arm of ["skip", "baseline", "random"] as const) {
    const creature = Creature.fromJSON(parent);
    const edges = applyArm(creature, arm, config, matchedCount);
    if (arm === "skip") matchedCount = edges.length;

    const profile = probeGradientDepth(creature, samples);
    const result: SkipArmResult = {
      arm,
      added: edges.length,
      edges,
      upstream: pooledZeroGradient(profile, entryDepth),
      entry: bucketZeroGradient(profile, entryDepth),
      chain: chainZeroGradient(profile),
    };

    if (train) {
      result.birth = summariseMagnitudes(magnitudesOf(creature, edges));
      result.errorBefore = datasetError(creature, data);
      trainCreature(creature, data, config.iterations);
      result.errorAfter = datasetError(creature, data);
      result.trained = summariseMagnitudes(magnitudesOf(creature, edges));
    }

    arms.push(result);
  }

  // Report in reading order, whatever order the arms were measured in.
  const order: SkipArm[] = ["baseline", "skip", "random"];
  arms.sort((a, b) => order.indexOf(a.arm) - order.indexOf(b.arm));

  return {
    config,
    provenance,
    entryDepth,
    runLength: chain.members.length,
    arms,
  };
}

/** Format a number for the report. */
function fmt(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e6) {
    return value.toExponential(2);
  }
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Format a fraction as a percentage. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Render the report as Markdown. */
export function formatSkipNullMarkdown(report: SkipNullReport): string {
  const lines: string[] = [];
  lines.push("## Skip-connection null comparison (Issue #3973)");
  lines.push("");
  lines.push(`- Creature: ${report.provenance}`);
  lines.push(
    `- Longest serial run: ${report.runLength} members, entry at depth ` +
      `${report.entryDepth}`,
  );
  lines.push(
    `- Seed ${report.config.seed}, ${report.config.samples} probe samples, ` +
      `up to ${report.config.skips} synapses per arm (the null arm matched to ` +
      `what the skip arm added), weight scale ${report.config.weightScale}, ` +
      `observation scale ${report.config.observationScale}`,
  );
  lines.push("");
  lines.push(
    "| Arm | Added | Entry zero-gradient | Chain zero-gradient | " +
      "Upstream zero-gradient | Error before → after | " +
      "Added \\|w\\| birth → trained |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const arm of report.arms) {
    const error = arm.errorBefore === undefined
      ? "—"
      : `${fmt(arm.errorBefore)} → ${fmt(arm.errorAfter)}`;
    const weights = arm.birth === undefined || arm.birth.count === 0
      ? "—"
      : `${fmt(arm.birth.median)} → ${fmt(arm.trained?.median)}`;
    lines.push(
      `| ${arm.arm} | ${arm.added} | ${pct(arm.entry.zeroFraction)} | ` +
        `${arm.chain ? pct(arm.chain.zeroFraction) : "—"} | ` +
        `${pct(arm.upstream.zeroFraction)} | ${error} | ${weights} |`,
    );
  }
  lines.push("");
  for (const arm of report.arms) {
    if (arm.edges.length === 0) continue;
    lines.push(`- **${arm.arm}** added: ${arm.edges.join(", ")}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const flags = parseFlags(Deno.args, [
    "creature",
    "skips",
    "seed",
    "samples",
    "iterations",
    "scale",
    "min-run",
    "run-length",
    "width",
    "inputs",
    "records",
    "obs-scale",
    "profile-only",
    "output",
  ]);

  const config = withSkipNullDefaults({
    creaturePath: flags.get("creature"),
    skips: numericFlag("skips", flags.get("skips"), SKIP_NULL_DEFAULTS.skips, {
      integer: true,
      minimum: 1,
    }),
    seed: numericFlag("seed", flags.get("seed"), SKIP_NULL_DEFAULTS.seed, {
      integer: true,
    }),
    samples: numericFlag(
      "samples",
      flags.get("samples"),
      SKIP_NULL_DEFAULTS.samples,
      { integer: true, minimum: 1 },
    ),
    iterations: numericFlag(
      "iterations",
      flags.get("iterations"),
      SKIP_NULL_DEFAULTS.iterations,
      { integer: true, minimum: 0 },
    ),
    weightScale: numericFlag(
      "scale",
      flags.get("scale"),
      SKIP_NULL_DEFAULTS.weightScale,
      { minimum: Number.MIN_VALUE },
    ),
    minRunLength: numericFlag(
      "min-run",
      flags.get("min-run"),
      SKIP_NULL_DEFAULTS.minRunLength,
      { integer: true, minimum: 2 },
    ),
    runLength: numericFlag(
      "run-length",
      flags.get("run-length"),
      SKIP_NULL_DEFAULTS.runLength,
      { integer: true, minimum: 2 },
    ),
    width: numericFlag("width", flags.get("width"), SKIP_NULL_DEFAULTS.width, {
      integer: true,
      minimum: 1,
    }),
    inputCount: numericFlag(
      "inputs",
      flags.get("inputs"),
      SKIP_NULL_DEFAULTS.inputCount,
      { integer: true, minimum: 1 },
    ),
    sampleCount: numericFlag(
      "records",
      flags.get("records"),
      SKIP_NULL_DEFAULTS.sampleCount,
      { integer: true, minimum: 1 },
    ),
    observationScale: numericFlag(
      "obs-scale",
      flags.get("obs-scale"),
      SKIP_NULL_DEFAULTS.observationScale,
      { minimum: Number.MIN_VALUE },
    ),
    profileOnly: flags.get("profile-only") === "true",
  });

  const previousRng = getRandomNumberGenerator();
  try {
    let parent: CreatureExport;
    let provenance: string;
    let data: DataRecordInterface[] | undefined;

    if (config.creaturePath) {
      const loaded = Creature.fromJSON(
        JSON.parse(await Deno.readTextFile(config.creaturePath)),
      );
      parent = loaded.exportJSON();
      provenance = config.creaturePath;
    } else {
      const parentRng = createSeededRng(config.seed);
      parent = buildTailParent(config, () => parentRng.random());
      provenance =
        `synthetic tuned parent (${config.width} wide, ${config.runLength}-member tail)`;
      const taskRng = createSeededRng(config.seed + 1_000);
      data = buildTask(config, () => taskRng.random());

      // Tune the parent first: an untuned parent makes every structural change
      // look harmless, and the whole comparison meaningless.
      const tuned = Creature.fromJSON(parent);
      trainCreature(tuned, data, config.iterations);
      parent = tuned.exportJSON();
    }

    const report = runSkipNullComparison(parent, provenance, config, data);
    const markdown = formatSkipNullMarkdown(report);
    console.info(markdown);

    const output = flags.get("output");
    if (output) {
      await Deno.writeTextFile(output, `${markdown}\n`);
      console.info(`\nWrote ${output}`);
    }
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}
