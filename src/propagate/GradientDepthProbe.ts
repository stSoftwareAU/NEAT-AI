/**
 * @module
 *
 * Measures how much gradient actually reaches a neuron, bucketed by depth
 * (Issue #3972).
 *
 * `docs/GRADIENT_DEPTH_PROBE.md` owns the explanation — why the measurement
 * exists, what each metric answers, how the reverse sweep models each squash,
 * and the inertness guarantee. It is linked here rather than copied so the two
 * cannot drift.
 *
 * The two invariants a reader of *this* file needs:
 *
 * - the creature handed in is **cloned**, so nothing belonging to the caller is
 *   read again or written, and every config field that would draw from the
 *   global RNG is pinned;
 * - the sweep is **read-only** — it is not an instrumented training loop, and
 *   nothing in the training path calls it.
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
import {
  RUNNER_UP_LEAK_FRACTION,
  runnerUpProximity,
} from "@methods/activations/aggregate/RunnerUpProximity.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import {
  BucketAccumulator,
  DEFAULT_QUANTILE_SAMPLE_LIMIT,
  type GradientDepthBucket,
  type ZeroGradientCause,
} from "@propagate/GradientDepthBuckets.ts";

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
  /** The same measurements restricted to that chain. */
  serialChainProfile?: SerialChainProfile;
}

/**
 * The chain cut of the profile.
 *
 * Every chain depth holds exactly one neuron, so the **per-depth** view of the
 * chain is already in {@link GradientDepthProfile.buckets} — the rows between
 * `startDepth` and `endDepth`. What is added here is the aggregate across the
 * whole chain, which no single depth bucket can show.
 */
export interface SerialChainProfile {
  /** Depth of the chain's first member. */
  startDepth: number;
  /** Depth of the chain's last member. */
  endDepth: number;
  /** Members of the chain. */
  totalMembers: number;
  /**
   * Members actually measured. Output neurons are excluded from measurement —
   * their gradient is the seed — so a chain ending at an output measures one
   * fewer member than it has.
   */
  measuredNeurons: number;
  /**
   * Every measurement of every chain member, pooled. Its `depth` field carries
   * `startDepth` so the record is self-describing; it is a chain aggregate, not
   * a depth level.
   */
  aggregate: GradientDepthBucket;
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
  /**
   * Runner-up leak factor per losing `MINIMUM` / `MAXIMUM` synapse, mirroring
   * `RUNNER_UP_LEAK_FRACTION * runnerUpProximity(...)` in the engine's own
   * `MINIMUM.propagate` / `MAXIMUM.propagate`. Absent means the synapse sat
   * outside the window and the engine leaks it nothing either.
   */
  leak: Map<Synapse, number>;
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
  /** Squash blamed for a `zero-derivative` block. */
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
  for (let i = 0; i < neuronCount; i++) outward[i] = [];
  for (const synapse of probe.synapses) {
    if (synapse.from === synapse.to) continue;
    if (depth[synapse.to] <= depth[synapse.from]) continue;
    outward[synapse.from].push(synapse);
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
  const chainAggregate = chain === undefined
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

  // The clone is disposed however this exits — it is the resource the
  // inertness guarantee rests on.
  try {
    for (const sample of samples) {
      probe.activateAndTrace(sample, false, sparseConfig);
      const activations = probe.state.activations;
      fillLocalDerivatives(probe, activations, local);

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
        const bucket = bucketFor(depth[index]);
        const chainCut = chainMembers.has(index) ? chainAggregate : undefined;

        bucket.record(index, value);
        chainCut?.record(index, value);
        if (havePrevious) {
          bucket.compareSign(previous[index], value);
          chainCut?.compareSign(previous[index], value);
        }

        if (value === 0) {
          const blamed = attribute(local, outward[index], gradient);
          for (const { cause, squash } of blamed) {
            bucket.blame(cause, squash);
            chainCut?.blame(cause, squash);
          }
        }
      }

      previous.set(gradient);
      havePrevious = true;
    }
  } finally {
    probe.dispose();
  }

  return {
    samples: samples.length,
    maxDepth,
    buckets: [...buckets.values()]
      .sort((a, b) => a.depth - b.depth)
      .map((bucket) => bucket.finish()),
    serialChain: chain,
    serialChainProfile: chain === undefined || chainAggregate === undefined
      ? undefined
      : {
        startDepth: chain.startDepth,
        endDepth: chain.endDepth,
        totalMembers: chain.members.length,
        measuredNeurons: chainAggregate.neurons.size,
        aggregate: chainAggregate.finish(),
      },
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
    leak: new Map<Synapse, number>(),
    positive: new Uint8Array(neuronCount),
    squashName: new Array(neuronCount),
  };
}

/**
 * Recompute every neuron's local derivative facts for the current sample.
 *
 * The forward quantities — the pre-activation value, the `MIN` / `MAX` winner,
 * the `IF` condition sum — read **every** inward synapse, because that is what
 * the engine's own activation does. Gradient routing is forward-only (see
 * `outward` in {@link probeGradientDepth}): a recurrent edge is not unrolled,
 * so on a topology that has one the recurrent term is read from the settled
 * activation array rather than the previous step's.
 */
function fillLocalDerivatives(
  creature: Creature,
  activations: Float32Array,
  local: LocalDerivatives,
): void {
  local.leak.clear();
  for (let index = 0; index < creature.neurons.length; index++) {
    const neuron = creature.neurons[index];
    if (neuron.type === "input" || neuron.type === "constant") {
      local.kind[index] = LocalKind.Leaf;
      continue;
    }

    const sources = creature.inwardConnections(index);
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

        // The engine does not starve every loser: one inside the proximity
        // window still receives `RUNNER_UP_LEAK_FRACTION * proximity` of the
        // error (Issue #1874). Modelling that here is what keeps
        // `unselected-min-max` from over-reporting dead routes.
        if (sources.length > 1) {
          for (const synapse of sources) {
            if (synapse === best) continue;
            const value = activations[synapse.from] * synapse.weight;
            // Runner-ups sit above the winner for MINIMUM, below for MAXIMUM.
            const distance = minimum ? value - bestValue : bestValue - value;
            const proximity = runnerUpProximity(bestValue, distance);
            if (proximity >= 0) {
              local.leak.set(synapse, RUNNER_UP_LEAK_FRACTION * proximity);
            }
          }
        }
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
        if (squash === undefined) {
          // Recording this as a zero slope would file it under
          // `zero-derivative` and blame the squash for a saturation that
          // was never measured. Fail loud instead.
          throw new ActivationError(
            `${neuron.squash} exposes no derivative(); the gradient-depth ` +
              `probe cannot measure neuron ${index}`,
            "UNKNOWN_ACTIVATION",
            neuron.squash ?? "unknown",
            value,
          );
        }
        local.slope[index] = squash.derivative(value);
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
    case LocalKind.Select: {
      if (local.selected[to] === synapse) return { factor: synapse.weight };
      const leak = local.leak.get(synapse);
      return leak === undefined
        ? { factor: 0, blockedBy: "unselected-min-max" }
        : { factor: leak * synapse.weight };
    }
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
          blockedBy: "zero-derivative",
          squash: local.squashName[to],
        }
        : { factor: slope * synapse.weight };
    }
  }
}

/**
 * Count every blocked route out of a neuron whose gradient was zero.
 *
 * Attribution is **per route**, not per neuron: an earlier revision picked the
 * cause blocking the most routes and broke ties by a fixed priority order,
 * which silently awarded every tie to whichever cause happened to be listed
 * first. Counting routes removes the tie-break, so the numbers cannot favour a
 * conclusion. A route that is open but leads to a neuron with no gradient of
 * its own is `downstream-zero` — the loss happened closer to the output; an
 * open route leading to one that *does* carry gradient means the contributions
 * cancelled.
 */
function attribute(
  local: LocalDerivatives,
  synapses: readonly Synapse[],
  gradient: Float64Array,
): { cause: ZeroGradientCause; squash?: string }[] {
  if (synapses.length === 0) return [{ cause: "unreached" }];

  const blamed: { cause: ZeroGradientCause; squash?: string }[] = [];
  for (const synapse of synapses) {
    const route = routeFor(local, synapse);
    if (route.blockedBy === undefined) {
      blamed.push({
        cause: gradient[synapse.to] === 0 ? "downstream-zero" : "cancellation",
      });
    } else {
      blamed.push({ cause: route.blockedBy, squash: route.squash });
    }
  }
  return blamed;
}
