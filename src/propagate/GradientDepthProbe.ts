/**
 * @module
 *
 * Measures how much gradient actually reaches a neuron, bucketed by depth.
 *
 * Issue #3972: GRQ creatures are 61 hops deep and the deep tail is single-file
 * — see {@link findSerialChains}. Every member of that tail is a construct that
 * can hand back an *exactly zero* derivative (`HARD_TANH` outside `(-1, 1)`,
 * the losing branch of a `MINIMUM` / `MAXIMUM`, the untaken branch of an `IF`),
 * so the preconditions for the shattered-gradient failure Balduzzi et al.
 * (2017) describe are all present. Whether the gradient is *actually* degraded
 * was unmeasured; this probe measures it.
 *
 * It is a **read-only** analysis, not an instrumented training loop. The
 * creature handed in is cloned before anything runs, so no weight, bias, trace
 * or cache belonging to the caller is touched — see the inertness test in
 * `test/propagate/GradientDepthProbeInert.ts`. That is also why it costs
 * nothing to leave switched off: nothing in the training path calls it.
 *
 * The measurement is a reverse-mode sweep over the same forward activations the
 * engine produced, using the same derivative implementations the engine's
 * backpropagation uses:
 *
 * - a scalar squash contributes `squash.derivative(value) * weight`, where
 *   `value = bias + Σ activation(from) * weight` (the aggregation
 *   `NeuronActivation.makeFunction` compiles);
 * - `MINIMUM` / `MAXIMUM` route the whole gradient to the winning inward
 *   synapse and nothing to the rest;
 * - `IF` routes it to the branch the condition sum selected, and nothing to the
 *   condition synapses, whose threshold has no usable derivative.
 *
 * ```mermaid
 * flowchart LR
 *     S[input sample] --> A[activateAndTrace on the clone]
 *     A --> R[reverse sweep<br/>deepest depth first]
 *     R --> B[per-depth buckets]
 *     B --> M[magnitude / exactly-zero / sign-flip]
 *     R --> Z[zero-gradient attribution]
 * ```
 */

import { Creature } from "@creature";
import type { Synapse } from "@architecture/Synapse.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import {
  longestSerialChain,
  type SerialChain,
} from "@propagate/SerialChains.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

/** Why a neuron saw an exactly-zero gradient on one sample. */
export type ZeroGradientCause =
  /** Every route out ran into a squash whose `derivative()` returned zero. */
  | "saturated-derivative"
  /** Every route out was the losing branch of a `MINIMUM` / `MAXIMUM`. */
  | "unselected-min-max"
  /** Every route out fed the branch an `IF` did not take. */
  | "untaken-if-branch"
  /** Every route out fed an `IF` condition — a threshold with no derivative. */
  | "if-condition"
  /** Every route out had weight zero. */
  | "zero-weight"
  /** Routes were open, but the neurons they lead to already had no gradient. */
  | "downstream-zero"
  /** Routes were open and carried gradient, but the contributions cancelled. */
  | "cancellation"
  /** The neuron has no forward route to anything at all. */
  | "unreached";

const ZERO_CAUSES: readonly ZeroGradientCause[] = [
  "saturated-derivative",
  "unselected-min-max",
  "untaken-if-branch",
  "if-condition",
  "zero-weight",
  "downstream-zero",
  "cancellation",
  "unreached",
];

/** The measured gradient profile of one depth level. */
export interface GradientDepthBucket {
  /** Depth, as {@link computeLayerAssignments} assigns it. */
  depth: number;
  /** Distinct neurons at this depth that were measured. */
  neurons: number;
  /** Neuron × sample measurements taken at this depth. */
  observations: number;
  /** Measurements whose gradient was exactly zero. */
  zeroObservations: number;
  /** `zeroObservations / observations`, or `0` when nothing was measured. */
  zeroFraction: number;
  /** Mean `|gradient|` over every measurement, zeroes included. */
  meanAbsGradient: number;
  /** Median `|gradient|`; `quantilesTruncated` says when it is a sample. */
  medianAbsGradient: number;
  /** 95th percentile `|gradient|`. */
  p95AbsGradient: number;
  /** Largest `|gradient|` seen. */
  maxAbsGradient: number;
  /** Consecutive-sample pairs where both gradients were non-zero. */
  signFlipComparisons: number;
  /** Of those pairs, how many reversed sign — the shattered-gradient signal. */
  signFlips: number;
  /** `signFlips / signFlipComparisons`, or `0` when nothing was comparable. */
  signFlipRate: number;
  /** Zero-gradient measurements attributed to each construct. */
  zeroCauses: Record<ZeroGradientCause, number>;
  /** Squash names blamed for `saturated-derivative`, by measurement count. */
  saturatedSquashes: Record<string, number>;
  /** True when the quantiles come from a truncated sample of measurements. */
  quantilesTruncated: boolean;
}

/** The whole profile: one bucket per depth, plus the serial-chain cut. */
export interface GradientDepthProfile {
  /** Samples fed through the creature. */
  samples: number;
  /** Deepest depth level measured. */
  maxDepth: number;
  /** One bucket per depth that held at least one measured neuron. */
  buckets: GradientDepthBucket[];
  /** The longest serial chain, when the topology has one. */
  serialChain?: SerialChain;
  /**
   * The same measurements restricted to {@link serialChain}'s members,
   * collapsed into a single bucket whose `depth` is the chain's start depth.
   */
  chainBucket?: GradientDepthBucket;
}

/** Knobs for {@link probeGradientDepth}. */
export interface GradientDepthProbeOptions {
  /**
   * Per-bucket cap on retained `|gradient|` values, which the quantiles are
   * read from. Beyond the cap the bucket keeps the first `limit` values and
   * reports `quantilesTruncated`. Default `100_000`.
   */
  quantileSampleLimit?: number;
}

const DEFAULT_QUANTILE_SAMPLE_LIMIT = 100_000;

/** Mutable accumulator behind one {@link GradientDepthBucket}. */
class BucketAccumulator {
  readonly neurons = new Set<number>();
  observations = 0;
  zeroObservations = 0;
  absSum = 0;
  absMax = 0;
  signFlipComparisons = 0;
  signFlips = 0;
  readonly magnitudes: number[] = [];
  quantilesTruncated = false;
  readonly zeroCauses = new Map<ZeroGradientCause, number>();
  readonly saturatedSquashes = new Map<string, number>();

  constructor(readonly depth: number, private readonly limit: number) {}

  record(neuronIndex: number, gradient: number) {
    this.neurons.add(neuronIndex);
    this.observations++;
    const magnitude = Math.abs(gradient);
    this.absSum += magnitude;
    if (magnitude > this.absMax) this.absMax = magnitude;
    if (gradient === 0) this.zeroObservations++;
    if (this.magnitudes.length < this.limit) {
      this.magnitudes.push(magnitude);
    } else {
      this.quantilesTruncated = true;
    }
  }

  blame(cause: ZeroGradientCause, squash?: string) {
    this.zeroCauses.set(cause, (this.zeroCauses.get(cause) ?? 0) + 1);
    if (squash !== undefined) {
      this.saturatedSquashes.set(
        squash,
        (this.saturatedSquashes.get(squash) ?? 0) + 1,
      );
    }
  }

  compareSign(previous: number, current: number) {
    if (previous === 0 || current === 0) return;
    this.signFlipComparisons++;
    if (Math.sign(previous) !== Math.sign(current)) this.signFlips++;
  }

  finish(): GradientDepthBucket {
    const sorted = this.magnitudes.slice().sort((a, b) => a - b);
    const zeroCauses = {} as Record<ZeroGradientCause, number>;
    for (const cause of ZERO_CAUSES) {
      zeroCauses[cause] = this.zeroCauses.get(cause) ?? 0;
    }
    return {
      depth: this.depth,
      neurons: this.neurons.size,
      observations: this.observations,
      zeroObservations: this.zeroObservations,
      zeroFraction: this.observations === 0
        ? 0
        : this.zeroObservations / this.observations,
      meanAbsGradient: this.observations === 0
        ? 0
        : this.absSum / this.observations,
      medianAbsGradient: quantile(sorted, 0.5),
      p95AbsGradient: quantile(sorted, 0.95),
      maxAbsGradient: this.absMax,
      signFlipComparisons: this.signFlipComparisons,
      signFlips: this.signFlips,
      signFlipRate: this.signFlipComparisons === 0
        ? 0
        : this.signFlips / this.signFlipComparisons,
      zeroCauses,
      saturatedSquashes: Object.fromEntries(
        [...this.saturatedSquashes].sort((a, b) => b[1] - a[1]),
      ),
      quantilesTruncated: this.quantilesTruncated,
    };
  }
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return sorted[position];
}

/** A scalar activation exposing the derivative the reverse sweep needs. */
type Differentiable = { derivative(x: number): number };

function asDifferentiable(squash: unknown): Differentiable | undefined {
  const candidate = squash as Partial<Differentiable> | undefined;
  return typeof candidate?.derivative === "function"
    ? candidate as Differentiable
    : undefined;
}

/**
 * How one neuron turns its inward synapses into a gradient for each source.
 *
 * - `Scalar` — `activation = squash(bias + Σ a·w)`; every source scales by
 *   `slope · w`.
 * - `Select` — `MINIMUM` / `MAXIMUM`; only the winning synapse scales by `w`.
 * - `Branch` — `IF`; only the taken branch scales by `w`, never the condition.
 * - `Leaf` — input or constant; nothing inward carries gradient.
 */
const LocalKind = {
  Scalar: 0,
  Select: 1,
  Branch: 2,
  Leaf: 3,
} as const;

/**
 * Per-neuron local derivative facts for one sample, computed once so a neuron
 * with a fan-in of 1,265 is not rescanned once per inward synapse.
 */
interface LocalDerivatives {
  kind: Int8Array;
  /** `squash.derivative(value)` for {@link LocalKind.Scalar} neurons. */
  slope: Float64Array;
  /** Winning inward synapse for {@link LocalKind.Select} neurons. */
  selected: (Synapse | undefined)[];
  /** Whether an {@link LocalKind.Branch} neuron took its positive branch. */
  positive: Uint8Array;
  /** Squash name blamed when a {@link LocalKind.Scalar} slope is zero. */
  squashName: (string | undefined)[];
}

/** How one outward synapse scales the gradient, and why when it does not. */
interface EdgeRoute {
  /** `d activation(to) / d activation(from)`. */
  factor: number;
  /** Set when `factor` is zero — the construct responsible. */
  blockedBy?: ZeroGradientCause;
  /** Squash blamed for a `saturated-derivative` block. */
  squash?: string;
}

/**
 * Measure the gradient reaching every hidden neuron, bucketed by depth.
 *
 * Output neurons are excluded: their gradient is the seed the sweep starts
 * from, not a measurement of anything.
 *
 * @param creature The creature to profile. It is cloned; the caller's creature
 *   is never written to.
 * @param samples Input rows, in the order they should be treated as
 *   consecutive steps — the sign-flip rate compares neighbouring rows.
 * @param options See {@link GradientDepthProbeOptions}.
 * @returns The per-depth profile, plus the serial-chain restriction.
 * @throws RangeError when `samples` is empty, or a row is the wrong width.
 */
export function probeGradientDepth(
  creature: Creature,
  samples: readonly Float32Array[],
  options: GradientDepthProbeOptions = {},
): GradientDepthProfile {
  if (samples.length === 0) {
    throw new RangeError("probeGradientDepth needs at least one sample");
  }
  const limit = options.quantileSampleLimit ?? DEFAULT_QUANTILE_SAMPLE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `quantileSampleLimit must be a positive integer, got ${limit}`,
    );
  }

  // Clone first: everything below runs against a private copy, which is what
  // makes the probe inert for the caller.
  const probe = Creature.fromJSON(creature.exportJSON());
  for (const sample of samples) {
    if (sample.length !== probe.input) {
      throw new RangeError(
        `sample width ${sample.length} does not match creature input ` +
          `${probe.input}`,
      );
    }
  }

  const neuronCount = probe.neurons.length;
  const outputStart = neuronCount - probe.output;
  const depth = depthPerNeuron(probe);
  const maxDepth = depth.reduce((a, b) => Math.max(a, b), 0);

  // Forward edges only: a synapse that does not increase depth is a back-edge,
  // which `computeLayerAssignments` also ignores.
  const outward: Synapse[][] = new Array(neuronCount);
  const inward: Synapse[][] = new Array(neuronCount);
  for (let i = 0; i < neuronCount; i++) {
    outward[i] = [];
    inward[i] = [];
  }
  for (const synapse of probe.synapses) {
    if (synapse.from === synapse.to) continue;
    if (depth[synapse.to] <= depth[synapse.from]) continue;
    outward[synapse.from].push(synapse);
    inward[synapse.to].push(synapse);
  }

  // Deepest first, so a neuron's gradient is complete before it is spent.
  const order: number[] = [];
  for (let i = 0; i < neuronCount; i++) order.push(i);
  order.sort((a, b) => depth[b] - depth[a] || b - a);

  const buckets = new Map<number, BucketAccumulator>();
  const bucketFor = (level: number) => {
    let bucket = buckets.get(level);
    if (bucket === undefined) {
      bucket = new BucketAccumulator(level, limit);
      buckets.set(level, bucket);
    }
    return bucket;
  };

  const chain = longestSerialChain(probe);
  const chainMembers = new Set(chain?.members.map((m) => m.index) ?? []);
  const chainBucket = chain === undefined
    ? undefined
    : new BucketAccumulator(chain.startDepth, limit);

  // Every randomised field is pinned. `createBackPropagationConfig` draws from
  // the global RNG for any option left undefined, and `sparseRatio: 1` makes
  // `chooseNeurons` deterministic — without both, a probe run would advance the
  // caller's RNG stream and change what a later seeded training run produced.
  const config = createBackPropagationConfig({
    generations: 1,
    trainingMutationRate: 1,
    learningRate: 0.01,
    learningRateStrategy: "fixed",
    dropoutRate: 0,
    sparseRatio: 1,
  });
  const sparseConfig = new SparseConfig(probe.exportJSON(), config);

  const local = emptyLocalDerivatives(neuronCount);
  const gradient = new Float64Array(neuronCount);
  const previous = new Float64Array(neuronCount);
  let havePrevious = false;

  for (const sample of samples) {
    probe.activateAndTrace(sample, false, sparseConfig);
    const activations = probe.state.activations;
    fillLocalDerivatives(probe, activations, inward, local);

    gradient.fill(0);
    for (let i = outputStart; i < neuronCount; i++) gradient[i] = 1;

    for (const index of order) {
      if (index >= outputStart) continue; // seeded, nothing feeds into it here
      let total = 0;
      for (const synapse of outward[index]) {
        const carried = gradient[synapse.to];
        if (carried === 0) continue;
        total += carried * routeFor(local, synapse).factor;
      }
      gradient[index] = total;
    }

    for (const index of order) {
      if (index >= outputStart) continue;
      const neuron = probe.neurons[index];
      if (neuron.type === "input" || neuron.type === "constant") continue;

      const value = gradient[index];
      const inChain = chainMembers.has(index) && chainBucket !== undefined;
      const bucket = bucketFor(depth[index]);

      bucket.record(index, value);
      if (havePrevious) bucket.compareSign(previous[index], value);
      if (inChain && chainBucket !== undefined) {
        chainBucket.record(index, value);
        if (havePrevious) chainBucket.compareSign(previous[index], value);
      }

      if (value === 0) {
        const { cause, squash } = attribute(local, outward[index], gradient);
        bucket.blame(cause, squash);
        if (inChain && chainBucket !== undefined) {
          chainBucket.blame(cause, squash);
        }
      }
    }

    previous.set(gradient);
    havePrevious = true;
  }

  probe.dispose();

  return {
    samples: samples.length,
    maxDepth,
    buckets: [...buckets.values()]
      .sort((a, b) => a.depth - b.depth)
      .map((bucket) => bucket.finish()),
    serialChain: chain,
    chainBucket: chainBucket?.finish(),
  };
}

/** Depth per neuron index, flattened from {@link computeLayerAssignments}. */
export function depthPerNeuron(creature: Creature): Int32Array {
  const depth = new Int32Array(creature.neurons.length);
  for (const [level, indexes] of computeLayerAssignments(creature)) {
    for (const index of indexes) depth[index] = level;
  }
  return depth;
}

function emptyLocalDerivatives(neuronCount: number): LocalDerivatives {
  return {
    kind: new Int8Array(neuronCount),
    slope: new Float64Array(neuronCount),
    selected: new Array(neuronCount),
    positive: new Uint8Array(neuronCount),
    squashName: new Array(neuronCount),
  };
}

/** Recompute every neuron's local derivative facts for the current sample. */
function fillLocalDerivatives(
  creature: Creature,
  activations: Float32Array,
  inward: readonly Synapse[][],
  local: LocalDerivatives,
): void {
  for (let index = 0; index < creature.neurons.length; index++) {
    const neuron = creature.neurons[index];
    if (neuron.type === "input" || neuron.type === "constant") {
      local.kind[index] = LocalKind.Leaf;
      continue;
    }

    const sources = inward[index];
    switch (neuron.squash) {
      case "MINIMUM":
      case "MAXIMUM": {
        local.kind[index] = LocalKind.Select;
        const minimum = neuron.squash === "MINIMUM";
        let best: Synapse | undefined;
        let bestValue = minimum
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY;
        for (const synapse of sources) {
          const value = activations[synapse.from] * synapse.weight;
          if (minimum ? value < bestValue : value > bestValue) {
            bestValue = value;
            best = synapse;
          }
        }
        local.selected[index] = best;
        break;
      }
      case "IF": {
        local.kind[index] = LocalKind.Branch;
        let condition = 0;
        for (const synapse of sources) {
          if (synapse.type !== "condition") continue;
          condition += activations[synapse.from] * synapse.weight;
        }
        local.positive[index] = condition > 0 ? 1 : 0;
        break;
      }
      default: {
        local.kind[index] = LocalKind.Scalar;
        local.squashName[index] = neuron.squash;
        let value = neuron.bias;
        for (const synapse of sources) {
          value += activations[synapse.from] * synapse.weight;
        }
        const squash = asDifferentiable(neuron.findSquash());
        // No derivative to read is reported as a zero slope rather than an
        // invented one — the profile must not claim signal it never measured.
        local.slope[index] = squash === undefined
          ? 0
          : squash.derivative(value);
        break;
      }
    }
  }
}

/** The partial derivative one forward synapse carries for this sample. */
function routeFor(local: LocalDerivatives, synapse: Synapse): EdgeRoute {
  const to = synapse.to;
  if (synapse.weight === 0) {
    return { factor: 0, blockedBy: "zero-weight" };
  }

  switch (local.kind[to]) {
    case LocalKind.Select:
      return local.selected[to] === synapse
        ? { factor: synapse.weight }
        : { factor: 0, blockedBy: "unselected-min-max" };
    case LocalKind.Branch: {
      if (synapse.type === "condition") {
        return { factor: 0, blockedBy: "if-condition" };
      }
      const onTakenBranch = local.positive[to] === 1
        ? synapse.type !== "negative"
        : synapse.type === "negative";
      return onTakenBranch
        ? { factor: synapse.weight }
        : { factor: 0, blockedBy: "untaken-if-branch" };
    }
    default: {
      const slope = local.slope[to];
      return slope === 0
        ? {
          factor: 0,
          blockedBy: "saturated-derivative",
          squash: local.squashName[to],
        }
        : { factor: slope * synapse.weight };
    }
  }
}

/**
 * Name the construct responsible for a zero gradient: the cause blocking the
 * most outward routes wins, with {@link ZERO_CAUSES} order breaking ties. A
 * route that is open but leads to a neuron with no gradient of its own is
 * `downstream-zero` — the loss happened closer to the output.
 */
function attribute(
  local: LocalDerivatives,
  synapses: readonly Synapse[],
  gradient: Float64Array,
): { cause: ZeroGradientCause; squash?: string } {
  if (synapses.length === 0) return { cause: "unreached" };

  const counts = new Map<ZeroGradientCause, number>();
  const squashes = new Map<string, number>();
  for (const synapse of synapses) {
    const route = routeFor(local, synapse);
    const cause: ZeroGradientCause = route.blockedBy ??
      (gradient[synapse.to] === 0 ? "downstream-zero" : "cancellation");
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
    if (cause === "saturated-derivative" && route.squash !== undefined) {
      squashes.set(route.squash, (squashes.get(route.squash) ?? 0) + 1);
    }
  }

  let winner: ZeroGradientCause = "downstream-zero";
  let best = -1;
  for (const cause of ZERO_CAUSES) {
    const count = counts.get(cause) ?? 0;
    if (count > best) {
      best = count;
      winner = cause;
    }
  }

  if (winner !== "saturated-derivative") return { cause: winner };

  let squash: string | undefined;
  let squashBest = -1;
  for (const [name, count] of squashes) {
    if (count > squashBest) {
      squashBest = count;
      squash = name;
    }
  }
  return { cause: winner, squash };
}
