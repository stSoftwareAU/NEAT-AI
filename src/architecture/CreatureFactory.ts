/**
 * Creature Factory (Issue #2794).
 *
 * Builds a smarter *initial* creature than `new Creature(nIn, nOut)` by
 * choosing the output activation, hidden-layer capacity, hidden squash, and
 * weight-scaling from problem metadata. The factory only seeds the starting
 * point — evolution (mutation, Discovery, breeding, training) proceeds
 * exactly as today. The principle: seed only from facts true of *any*
 * problem, never a dataset-specific architecture copied from a benchmark.
 *
 * The factory lives in its own module so {@link Creature} does not grow.
 * `Creature.ts` and `evolveDir` signatures are unchanged; the factory simply
 * hands `evolveDir` a better starting `Creature`.
 *
 * Sources for the heuristics used here:
 *
 * - Output activation + loss coupling: ML Mastery
 *   <https://machinelearningmastery.com/choose-an-activation-function-for-deep-learning/>
 *   and the canonical CostDescriptor table.
 * - Weight initialisation: He vs Xavier
 *   <https://www.aryanupadhyay.com/post/why-weight-initialization-is-important-in-deep-learning-xavier-vs-he-explained>.
 * - Hidden-layer capacity: Heaton, "The Number of Hidden Layers"
 *   <https://www.heatonresearch.com/2017/06/01/hidden-layers.html>.
 *
 * Two factory entry points:
 *
 * - {@link creatureForProblem} — metadata-only, no data scan. Uses
 *   `(inputs, outputs, cost)` plus declarable `inputRange` / `outputRange`
 *   to pick output activation, hidden capacity, and weight scaling.
 * - {@link creatureForDataset} — optional scan over a training set. Adds
 *   only the non-declarable smarts: dead/constant feature pruning and
 *   target-mean output bias initialisation. Normalisation is *not* a
 *   reason to scan once ranges are declared.
 *
 * The public API on {@link Creature} surfaces these as static methods:
 *
 * ```ts
 * const seed  = Creature.forProblem({ inputs, outputs, cost, inputRange, outputRange });
 * const seed2 = Creature.forDataset(trainingData, { cost });
 * await seed.evolveDir(dir); // unchanged
 * ```
 */

import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { pickOutputSquashForCost } from "@costs/CostOutputSquash.ts";
import { addTag, getTag } from "@stsoftware/tags/mod";

/** Inclusive numeric range, e.g. `{ min: -1, max: 1 }`. */
export interface NumericRange {
  min: number;
  max: number;
}

/**
 * Problem metadata for {@link creatureForProblem}.
 *
 * Only `inputs` and `outputs` are required. Every other field is an
 * optional hint that lets the factory make a smarter seed without needing
 * to scan the data.
 */
export interface ProblemSpec {
  /** Number of observation features (input neurons). */
  inputs: number;
  /** Number of output neurons. */
  outputs: number;
  /**
   * Cost / task name (e.g. `"MSE"`, `"CROSS_ENTROPY"`,
   * `"BINARY_CROSS_ENTROPY"`, `"HINGE"`). When omitted, the factory falls
   * back to the regression defaults (linear output, no bias).
   */
  cost?: string;
  /**
   * Declared input value range. When provided the factory does *not* try
   * to normalise inputs — declared-as-already-normalised inputs are
   * trusted. The scan-tier (dead-feature pruning) ignores this range; it
   * only inspects per-feature variance.
   */
  inputRange?: NumericRange;
  /**
   * Declared output value range. When the cost has no built-in output
   * pairing (regression costs like MSE) and the range is bounded
   * symmetrically (≈ `[-1, 1]`), the factory picks TANH; otherwise it
   * picks the linear IDENTITY activation.
   */
  outputRange?: NumericRange;
  /**
   * Optional override for hidden-layer width. When omitted the factory
   * derives capacity from `(inputs, outputs)` using Heaton's rule for
   * small problems and the geometric mean for high-dimensional ones.
   */
  hiddenCapacity?: number;
  /**
   * Optional override for hidden-neuron squash. When omitted the factory
   * defaults to `"RELU"`, which composes well with He initialisation.
   */
  hiddenSquash?: string;
  /**
   * Whether feedback / recurrent topology is allowed. Mirrors
   * `CreatureOptions.feedbackEnabled`; defaults to forward-only.
   */
  feedbackEnabled?: boolean;
  /**
   * Optional seed warm-up length (generations). When set, the factory
   * writes a `warmupGenerations` creature tag so evolution can defer
   * structural pruning and squash changes until weights/biases align.
   */
  warmupGenerations?: number;
}

/** Result of {@link scanTrainingData}: the non-declarable observations. */
export interface DatasetScan {
  /** Number of records scanned. */
  sampleCount: number;
  /** Per-input feature mean over the scanned records. */
  inputMean: Float32Array;
  /** Per-input feature variance over the scanned records (population). */
  inputVariance: Float32Array;
  /**
   * Indices of inputs whose variance is below {@link DEAD_FEATURE_VARIANCE_THRESHOLD}.
   * Empty when no dead features were detected.
   */
  deadInputIndices: number[];
  /** Per-output target mean over the scanned records. */
  outputMean: Float32Array;
  /** Per-output target variance over the scanned records. */
  outputVariance: Float32Array;
}

/**
 * Variance below this is treated as a "constant / near-constant" input
 * feature in {@link scanTrainingData}. Far smaller than the per-feature
 * variance of any meaningful normalised input.
 */
export const DEAD_FEATURE_VARIANCE_THRESHOLD = 1e-8;

/**
 * High-dimensional crossover: above this input count the factory prefers
 * the geometric-mean capacity rule (sqrt(n_in·n_out)) over Heaton's rule
 * (2/3·n_in + n_out) to avoid seeding 2000-wide hidden layers for
 * sample-limited problems.
 */
export const HIGH_DIMENSIONAL_INPUT_THRESHOLD = 100;

/** Creature tag key for seed warm-up generation count. */
export const WARMUP_GENERATIONS_TAG = "warmupGenerations";

/** Creature tag key for evolution progress during seed warm-up resume. */
export const CURRENT_GENERATION_TAG = "currentGeneration";

/**
 * Parse the seed warm-up generation count from a creature tag.
 * Returns 0 when the tag is absent or invalid (no warm-up).
 */
export function readWarmupGenerationsFromCreature(creature: Creature): number {
  const tag = getTag(creature, WARMUP_GENERATIONS_TAG);
  if (!tag) return 0;
  const n = Number.parseInt(tag, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse the saved evolution generation from a creature tag.
 * Returns 0 when the tag is absent or invalid.
 */
export function readCurrentGenerationFromCreature(creature: Creature): number {
  const tag = getTag(creature, CURRENT_GENERATION_TAG);
  if (!tag) return 0;
  const n = Number.parseInt(tag, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Issue #2828: Centralised seed warm-up structural lock.
 *
 * While the lock is active, no path may apply structural reduction or
 * squash changes to a warm-up seed — neither mutations, inline Discovery,
 * Discovery replay, nor pruning-template DNA sharing. This lets a factory
 * topology (e.g. 50 hidden → 1 output) align weights/biases before any
 * structural pruning is permitted.
 *
 * The lock is active when warm-up is configured (`warmupGenerations > 0`)
 * and the current generation has not yet passed it
 * (`currentGeneration <= warmupGenerations`).
 *
 * Conservative default: when warm-up is configured but the current
 * generation is unknown (`<= 0`, e.g. a freshly seeded creature whose
 * `currentGeneration` tag has not been written yet), the lock stays
 * **active**. We never prune a warm-up seed before we can prove the
 * warm-up window has elapsed.
 */
export function isSeedWarmupStructuralLockActive(
  warmupGenerations: number,
  currentGeneration: number,
): boolean {
  if (!Number.isFinite(warmupGenerations) || warmupGenerations <= 0) {
    // No warm-up configured — structural changes are always allowed.
    return false;
  }
  if (!Number.isFinite(currentGeneration) || currentGeneration <= 0) {
    // Warm-up configured but generation unknown — stay locked.
    return true;
  }
  return currentGeneration <= warmupGenerations;
}

/**
 * Read the seed warm-up structural lock state directly from a creature's
 * tags. Used by paths (e.g. {@link DiscoveryReplayQueue}) that only have
 * the creature, not the owning `Neat` instance.
 */
export function isSeedWarmupStructuralLockActiveForCreature(
  creature: Creature,
): boolean {
  return isSeedWarmupStructuralLockActive(
    readWarmupGenerationsFromCreature(creature),
    readCurrentGenerationFromCreature(creature),
  );
}

/**
 * Persist seed warm-up progress on a creature so export/load can resume
 * evolution with the correct warm-up gate.
 */
export function writeSeedWarmupProgressTags(
  creature: Creature,
  warmupGenerations: number,
  currentGeneration: number,
): void {
  if (Number.isFinite(warmupGenerations) && warmupGenerations > 0) {
    addTag(
      creature,
      WARMUP_GENERATIONS_TAG,
      String(Math.floor(warmupGenerations)),
    );
  }
  if (Number.isFinite(currentGeneration) && currentGeneration > 0) {
    addTag(
      creature,
      CURRENT_GENERATION_TAG,
      String(Math.floor(currentGeneration)),
    );
  }
}

function applyWarmupGenerationsTag(
  creature: Creature,
  warmupGenerations: number | undefined,
): void {
  if (warmupGenerations === undefined) return;
  if (!Number.isFinite(warmupGenerations) || warmupGenerations < 0) {
    throw new RangeError(
      `warmupGenerations must be a non-negative integer, got ${warmupGenerations}`,
    );
  }
  const n = Math.floor(warmupGenerations);
  if (n > 0) {
    addTag(creature, WARMUP_GENERATIONS_TAG, String(n));
  }
}

// ─── Activation families (for weight-init scaling) ──────────────────────

/** Activations paired with He initialisation: stddev = sqrt(2 / fan_in). */
const HE_FAMILY: ReadonlySet<string> = new Set([
  "RELU",
  "ReLU",
  "LeakyReLU",
  "RELU6",
  "ReLU6",
  "ELU",
  "SELU",
  "GELU",
  "Mish",
  "MISH",
  "Swish",
  "SWISH",
  "Softplus",
  "SOFTPLUS",
]);

/** Activations paired with Xavier/Glorot: stddev = sqrt(2 / (fan_in+fan_out)). */
const XAVIER_FAMILY: ReadonlySet<string> = new Set([
  "LOGISTIC",
  "TANH",
  "BIPOLAR_SIGMOID",
  "SOFTSIGN",
  "SOFTMAX",
  "ArcTan",
  "ARCTAN",
  "HARD_TANH",
  "LogSigmoid",
  "BIPOLAR",
  "IDENTITY",
]);

/**
 * Standard deviation of a uniform draw on `[-0.5, 0.5]` (the existing
 * {@link Synapse.randomWeight} range with `scale = 1`). Used to rescale
 * the constructor's random weights to the target init stddev.
 */
const RANDOM_WEIGHT_STDDEV = Math.sqrt(1 / 12);

/**
 * Pick the output squash for a problem spec.
 *
 * The cost descriptor takes precedence (e.g. CROSS_ENTROPY → SOFTMAX).
 * Regression costs (which return `undefined` from
 * {@link pickOutputSquashForCost}) then look at `outputRange`:
 *
 * - Bounded symmetric ≈ `[-1, 1]` → `TANH`.
 * - Bounded ≥ 0 → `LOGISTIC` if `[0, 1]`, otherwise still TANH.
 * - Unbounded / unknown → `IDENTITY` (linear), the standard regression
 *   choice.
 */
export function pickOutputSquashForProblem(spec: ProblemSpec): string {
  const costPick = pickOutputSquashForCost(spec.cost, spec.outputs);
  if (costPick) return costPick;

  const range = spec.outputRange;
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    const min = range.min;
    const max = range.max;
    if (Math.abs(min + max) < 1e-6 && max > 0) {
      // Symmetric around zero → bipolar bounded output.
      return "TANH";
    }
    if (min >= 0 && max <= 1) {
      // Unit-interval target → Bernoulli-style sigmoid.
      return "LOGISTIC";
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      // Bounded but not on a canonical interval — default to TANH which
      // at least cannot blow up.
      return "TANH";
    }
  }

  // No cost opinion, no range → linear regression output.
  return "IDENTITY";
}

/**
 * Pick a starting hidden-layer width from `(inputs, outputs)`.
 *
 * Heaton's "between input and output" rule is used for small problems
 * (`inputs < HIGH_DIMENSIONAL_INPUT_THRESHOLD`); the geometric mean
 * `sqrt(inputs·outputs)` is used for high-dimensional problems where
 * `2/3·inputs + outputs` is far too wide. Always returns at least 1.
 */
export function pickHiddenCapacity(spec: ProblemSpec): number {
  if (spec.hiddenCapacity !== undefined) {
    return Math.max(1, Math.floor(spec.hiddenCapacity));
  }
  const nIn = Math.max(1, Math.floor(spec.inputs));
  const nOut = Math.max(1, Math.floor(spec.outputs));

  if (nIn >= HIGH_DIMENSIONAL_INPUT_THRESHOLD) {
    // High-dim / sample-limited regime — geometric mean. The worked
    // example in #2794: n_in=3000, n_out=1 → 55.
    return Math.max(1, Math.round(Math.sqrt(nIn * nOut)));
  }

  // Heaton's rule, capped at 2·n_in.
  const heaton = Math.ceil((2 / 3) * nIn + nOut);
  const cap = Math.max(1, Math.floor(2 * nIn));
  return Math.max(1, Math.min(heaton, cap));
}

/**
 * Return the target standard deviation for a synapse weight whose
 * destination neuron uses `squash`, given the layer's `fan_in` /
 * `fan_out`.
 */
export function targetInitStddev(
  squash: string | undefined,
  fanIn: number,
  fanOut: number,
): number {
  const fIn = Math.max(1, fanIn);
  const fOut = Math.max(1, fanOut);
  if (squash && HE_FAMILY.has(squash)) {
    return Math.sqrt(2 / fIn);
  }
  if (squash && XAVIER_FAMILY.has(squash)) {
    return Math.sqrt(2 / (fIn + fOut));
  }
  // Conservative default: LeCun-style 1/sqrt(fan_in).
  return Math.sqrt(1 / fIn);
}

/**
 * Rescale every non-input synapse weight so its expected stddev matches
 * the target init for the destination neuron's squash. Operates in place;
 * preserves the sign and zero-cluster of {@link Synapse.randomWeight}.
 */
export function rescaleWeightsForInit(creature: Creature): void {
  // Count fan_in per destination and fan_out per source.
  const fanIn = new Int32Array(creature.neurons.length);
  const fanOut = new Int32Array(creature.neurons.length);
  for (const s of creature.synapses) {
    fanIn[s.to]++;
    fanOut[s.from]++;
  }

  for (const s of creature.synapses) {
    const dest = creature.neurons[s.to];
    const target = targetInitStddev(dest.squash, fanIn[s.to], fanOut[s.from]);
    // Scale the existing random weight from its native uniform stddev to
    // the target stddev. Preserves the constructor's deterministic
    // sampling order — useful for reproducibility under a seeded RNG.
    const scale = target / RANDOM_WEIGHT_STDDEV;
    s.weight = s.weight * scale;
  }
}

/**
 * Metadata-only factory entry point. See {@link ProblemSpec} for the
 * supported hints.
 *
 * @example
 * ```ts
 * const seed = creatureForProblem({
 *   inputs: 3000,
 *   outputs: 1,
 *   cost: "MSE",
 *   outputRange: { min: -1, max: 1 },
 * });
 * // → small hidden layer (~55), TANH output, He-scaled weights.
 * ```
 */
export function creatureForProblem(spec: ProblemSpec): Creature {
  if (!Number.isFinite(spec.inputs) || spec.inputs < 1) {
    throw new RangeError(
      `creatureForProblem: inputs must be ≥ 1, got ${spec.inputs}`,
    );
  }
  if (!Number.isFinite(spec.outputs) || spec.outputs < 1) {
    throw new RangeError(
      `creatureForProblem: outputs must be ≥ 1, got ${spec.outputs}`,
    );
  }

  const outputSquash = pickOutputSquashForProblem(spec);
  const hiddenCount = pickHiddenCapacity(spec);
  const hiddenSquash = spec.hiddenSquash ?? "RELU";

  const creature = new Creature(
    Math.floor(spec.inputs),
    Math.floor(spec.outputs),
    {
      costName: spec.cost,
      outputLayer: { squash: outputSquash },
      layers: hiddenCount > 0
        ? [{ count: hiddenCount, squash: hiddenSquash }]
        : undefined,
      feedbackEnabled: spec.feedbackEnabled,
    },
  );

  rescaleWeightsForInit(creature);
  applyWarmupGenerationsTag(creature, spec.warmupGenerations);
  return creature;
}

/**
 * Scan a training set for the non-declarable signals the metadata-only
 * factory cannot infer:
 *
 * - Per-input feature mean / variance (and dead/constant features).
 * - Per-output target mean / variance (for bias warm-start).
 *
 * Deliberately *not* in scope: normalisation. Once `inputRange` is
 * declared (see {@link ProblemSpec.inputRange}) the normalisation motive
 * to scan disappears, so the factory does not attempt it.
 *
 * Time / space complexity: O(N · (inputs + outputs)). For very large
 * datasets the caller can pass a sampled subset.
 */
export function scanTrainingData(
  records: readonly DataRecordInterface[],
): DatasetScan {
  if (records.length === 0) {
    throw new RangeError(
      "scanTrainingData: training set must contain at least one record",
    );
  }
  const inputLen = records[0].input.length;
  const outputLen = records[0].output.length;
  if (inputLen === 0) {
    throw new RangeError("scanTrainingData: input length must be ≥ 1");
  }

  // Welford's algorithm for stable per-dim mean/variance.
  const inputMean = new Float64Array(inputLen);
  const inputM2 = new Float64Array(inputLen);
  const outputMean = new Float64Array(outputLen);
  const outputM2 = new Float64Array(outputLen);

  let n = 0;
  for (const rec of records) {
    if (rec.input.length !== inputLen) {
      throw new RangeError(
        `scanTrainingData: inconsistent input length at record ${n}: ` +
          `expected ${inputLen}, got ${rec.input.length}`,
      );
    }
    if (rec.output.length !== outputLen) {
      throw new RangeError(
        `scanTrainingData: inconsistent output length at record ${n}: ` +
          `expected ${outputLen}, got ${rec.output.length}`,
      );
    }
    n++;
    for (let i = 0; i < inputLen; i++) {
      const x = rec.input[i];
      const delta = x - inputMean[i];
      inputMean[i] += delta / n;
      const delta2 = x - inputMean[i];
      inputM2[i] += delta * delta2;
    }
    for (let j = 0; j < outputLen; j++) {
      const y = rec.output[j];
      const delta = y - outputMean[j];
      outputMean[j] += delta / n;
      const delta2 = y - outputMean[j];
      outputM2[j] += delta * delta2;
    }
  }

  const inputVariance = new Float32Array(inputLen);
  const dead: number[] = [];
  for (let i = 0; i < inputLen; i++) {
    const v = n > 0 ? inputM2[i] / n : 0;
    inputVariance[i] = v;
    if (v <= DEAD_FEATURE_VARIANCE_THRESHOLD) dead.push(i);
  }
  const outputVariance = new Float32Array(outputLen);
  for (let j = 0; j < outputLen; j++) {
    outputVariance[j] = n > 0 ? outputM2[j] / n : 0;
  }

  const inputMeanF32 = new Float32Array(inputLen);
  for (let i = 0; i < inputLen; i++) inputMeanF32[i] = inputMean[i];
  const outputMeanF32 = new Float32Array(outputLen);
  for (let j = 0; j < outputLen; j++) outputMeanF32[j] = outputMean[j];

  return {
    sampleCount: n,
    inputMean: inputMeanF32,
    inputVariance,
    deadInputIndices: dead,
    outputMean: outputMeanF32,
    outputVariance,
  };
}

/** Options for {@link creatureForDataset}. */
export interface DatasetFactoryOptions {
  /** Cost / task name (see {@link ProblemSpec.cost}). */
  cost?: string;
  /** Declared input value range; identical semantics to {@link ProblemSpec.inputRange}. */
  inputRange?: NumericRange;
  /** Declared output value range; identical semantics to {@link ProblemSpec.outputRange}. */
  outputRange?: NumericRange;
  /** Hidden-layer width override. */
  hiddenCapacity?: number;
  /** Hidden-neuron squash override. */
  hiddenSquash?: string;
  /** Whether feedback / recurrent topology is allowed. */
  feedbackEnabled?: boolean;
  /** Seed warm-up length; see {@link ProblemSpec.warmupGenerations}. */
  warmupGenerations?: number;
}

/**
 * Dataset-aware factory. Scans `records` for non-declarable signals
 * (dead features, target stats) and seeds the creature accordingly:
 *
 * - **Dead-feature pruning** — synapses originating from constant inputs
 *   are zeroed so the initial forward pass does not propagate their
 *   noise. The input neuron itself is left in place because input arity
 *   is fixed for the lifetime of a creature.
 * - **Output bias warm-start** — for regression-style costs (no
 *   classification output activation), each output neuron's bias is set
 *   to the mean of its target column. The model can therefore predict
 *   the mean without any training, dramatically lowering the starting
 *   loss.
 *
 * @returns a fresh {@link Creature} ready for `evolveDir`.
 */
export function creatureForDataset(
  records: readonly DataRecordInterface[],
  options: DatasetFactoryOptions = {},
): Creature {
  if (records.length === 0) {
    throw new RangeError(
      "creatureForDataset: training set must contain at least one record",
    );
  }
  const scan = scanTrainingData(records);
  const inputs = records[0].input.length;
  const outputs = records[0].output.length;

  const spec: ProblemSpec = {
    inputs,
    outputs,
    cost: options.cost,
    inputRange: options.inputRange,
    outputRange: options.outputRange,
    hiddenCapacity: options.hiddenCapacity,
    hiddenSquash: options.hiddenSquash,
    feedbackEnabled: options.feedbackEnabled,
    warmupGenerations: options.warmupGenerations,
  };
  const creature = creatureForProblem(spec);

  // Output bias warm-start — only meaningful when the output activation
  // is the linear IDENTITY (regression). Classification activations
  // (SOFTMAX / LOGISTIC / TANH) sit on a non-linear curve so the mean
  // target is not a sensible bias.
  const outputSquash = pickOutputSquashForProblem(spec);
  if (outputSquash === "IDENTITY") {
    const outputNeurons = creature.neurons.filter((n) => n.type === "output");
    for (
      let j = 0;
      j < outputNeurons.length && j < scan.outputMean.length;
      j++
    ) {
      const mean = scan.outputMean[j];
      if (Number.isFinite(mean)) outputNeurons[j].bias = mean;
    }
  }

  // Dead-feature pruning: zero out synapses originating from inputs
  // whose variance was at floor.
  if (scan.deadInputIndices.length > 0) {
    const dead = new Set(scan.deadInputIndices);
    for (const synapse of creature.synapses) {
      if (dead.has(synapse.from)) synapse.weight = 0;
    }
  }

  return creature;
}
