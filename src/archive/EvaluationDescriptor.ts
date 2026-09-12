/**
 * EvaluationDescriptor.ts — the versioned feature vector an evaluation archive
 * record is keyed on (Issue #3929).
 *
 * Every surrogate in [Jin (2011)](../../docs/comparison/REFERENCES.md) is a
 * supervised model fitted to `(design point, true fitness)` pairs. The *design
 * point* is this vector: a fixed-length, purely structural summary of a
 * creature that can be computed without touching the corpus.
 *
 * **Descriptor stability is the whole contract.** If the meaning of a slot
 * drifts, an archive silently becomes a mixture of two feature spaces and every
 * model fitted to it is wrong in a way no error metric reveals. So:
 *
 * - The layout is **versioned** ({@link EVALUATION_DESCRIPTOR_VERSION}) and the
 *   version is written on every record. A reader refuses to mix versions.
 * - The squash histogram runs over a **frozen** list of names
 *   ({@link DESCRIPTOR_V1_SQUASH_NAMES}), not over the live activation
 *   registry. Registering a new activation therefore lands in the `squash:other`
 *   slot and does **not** change the layout — the registry is free to grow
 *   without invalidating an archive.
 * - Adding, removing, or re-meaning a slot means **bumping the version**.
 *
 * Only IEEE-deterministic arithmetic (`+`, `*`, `/`, `Math.sqrt`) is used, so
 * re-deriving a descriptor from the same creature reproduces the same vector
 * bit for bit on every platform — which is what makes the reproducibility gate
 * in `test/archive/EvaluationDescriptor.ts` meaningful.
 *
 * @module EvaluationDescriptor
 */

import type { Creature } from "@creature";
import { Activations } from "@methods/activations/Activations.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Layout version of the descriptor vector.
 *
 * Bump this whenever a slot is added, removed, reordered, or given a new
 * meaning. Records written under a different version are refused on read
 * rather than coerced.
 */
export const EVALUATION_DESCRIPTOR_VERSION = 1;

/**
 * The canonical squash names the v1 histogram counts, in slot order.
 *
 * **Frozen by hand, deliberately.** Deriving this from `Activations.list()`
 * would let a newly registered activation silently change the vector length —
 * exactly the drift the version contract exists to prevent. Anything not named
 * here is counted in the trailing `squash:other` slot.
 */
export const DESCRIPTOR_V1_SQUASH_NAMES: readonly string[] = Object.freeze([
  "ABSOLUTE",
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "COMPLEMENT",
  "Cosine",
  "Cube",
  "ELU",
  "Exponential",
  "GAUSSIAN",
  "GELU",
  "HARD_TANH",
  "HYPOT",
  "HYPOTv2",
  "IDENTITY",
  "IF",
  "ISRU",
  "LOGISTIC",
  "LeakyReLU",
  "LogSigmoid",
  "MAXIMUM",
  "MEAN",
  "MINIMUM",
  "Mish",
  "ReLU",
  "ReLU6",
  "SELU",
  "SINE",
  "SOFTMAX",
  "SOFTSIGN",
  "SQRT",
  "SQUARE",
  "STEP",
  "Softplus",
  "StdInverse",
  "Swish",
  "TAN",
  "TANH",
]);

/**
 * The scalar slots of the v1 vector, in order, ahead of the squash histogram.
 *
 * `geneticDistanceToReference` is `1 - geneticCompatibility(creature,
 * reference)`, or {@link NO_REFERENCE_DISTANCE} when no reference creature was
 * supplied — a sentinel rather than a plausible number, so "no fittest yet" can
 * never be mistaken for "maximally distant".
 */
/**
 * `meanFanIn` is the mean in-degree over neurons that receive at least one
 * synapse; `meanFanOut` the mean out-degree over neurons that emit at least
 * one. `biasMeanAbs` is the mean bias magnitude over neurons that carry a bias.
 * All three are taken over the participating population, never over the whole
 * neuron array, so none of them is diluted by neurons the statistic cannot
 * apply to.
 */
export const DESCRIPTOR_V1_SCALAR_NAMES: readonly string[] = Object.freeze([
  "neurons",
  "inputs",
  "outputs",
  "hiddenNeurons",
  "constantNeurons",
  "synapses",
  "depth",
  "meanFanIn",
  "maxFanIn",
  "meanFanOut",
  "maxFanOut",
  "weightMeanAbs",
  "weightMaxAbs",
  "weightRms",
  "biasMeanAbs",
  "biasMaxAbs",
  "geneticDistanceToReference",
]);

/**
 * Value of the `geneticDistanceToReference` slot when no reference creature was
 * available (the first scored generation of a run, typically).
 */
export const NO_REFERENCE_DISTANCE = -1;

/** Every v1 slot name, in vector order. */
export const DESCRIPTOR_V1_FIELD_NAMES: readonly string[] = Object.freeze([
  ...DESCRIPTOR_V1_SCALAR_NAMES,
  ...DESCRIPTOR_V1_SQUASH_NAMES.map((name) => `squash:${name}`),
  "squash:other",
]);

/** Fixed length of a v1 descriptor vector. */
export const EVALUATION_DESCRIPTOR_LENGTH = DESCRIPTOR_V1_FIELD_NAMES.length;

/** Slot index of each frozen squash name, resolved once. */
const SQUASH_SLOT: ReadonlyMap<string, number> = new Map(
  DESCRIPTOR_V1_SQUASH_NAMES.map((name, i) => [
    name,
    DESCRIPTOR_V1_SCALAR_NAMES.length + i,
  ]),
);

/** Slot the histogram falls back to for an activation not in the frozen list. */
const SQUASH_OTHER_SLOT = EVALUATION_DESCRIPTOR_LENGTH - 1;

/** Unresolvable squash names already warned about, so the log stays bounded. */
const warnedUnknownSquashes = new Set<string>();

/**
 * Canonicalise a squash name so aliases (`RELU` / `ReLU`) share a slot.
 *
 * An activation the registry cannot resolve is a separate bug, and a silent
 * fallback is exactly how a feature space changes meaning unnoticed — so it is
 * warned about (once per name, because a production creature has thousands of
 * neurons) and then counted under `squash:other`, where it stays visible.
 * Throwing here would make one bad neuron cost the whole generation's archive.
 *
 * @param squash - The raw squash name read off a neuron.
 * @returns The canonical name, or the raw name when the registry cannot resolve
 *   it.
 */
function canonicalSquashName(squash: string): string {
  try {
    return Activations.find(squash).getName();
  } catch {
    if (!warnedUnknownSquashes.has(squash)) {
      warnedUnknownSquashes.add(squash);
      getLogger().warn(
        `[NEAT-AI] Evaluation descriptor: unknown squash "${squash}" counted ` +
          `under squash:other. This is a bug elsewhere — the descriptor is ` +
          `reporting it, not hiding it.`,
      );
    }
    return squash;
  }
}

/**
 * Compute the v1 descriptor for `creature`.
 *
 * Cost is `O(neurons + synapses)` plus one layer assignment and (when a
 * reference is given) one genetic-distance lookup, which the distance cache
 * usually serves. Nothing here reads the corpus.
 *
 * @param creature - The creature to summarise.
 * @param reference - The run's current fittest creature, for the genetic
 *   distance slot. Omit when none exists yet.
 * @returns A fresh vector of {@link EVALUATION_DESCRIPTOR_LENGTH} numbers.
 */
export function computeEvaluationDescriptor(
  creature: Creature,
  reference?: Creature,
): number[] {
  const vector = new Array<number>(EVALUATION_DESCRIPTOR_LENGTH).fill(0);

  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const synapses = creature.synapses;
  const synapseCount = synapses.length;

  let hidden = 0;
  let constants = 0;
  let biasAbsSum = 0;
  let biasMaxAbs = 0;
  let biasedNeurons = 0;
  for (const neuron of neurons) {
    if (neuron.type === "hidden") hidden++;
    else if (neuron.type === "constant") constants++;

    const bias = neuron.bias;
    if (typeof bias === "number" && Number.isFinite(bias)) {
      const magnitude = Math.abs(bias);
      biasAbsSum += magnitude;
      biasedNeurons++;
      if (magnitude > biasMaxAbs) biasMaxAbs = magnitude;
    }

    const squash = neuron.squash;
    if (squash === undefined) continue;
    if (neuron.type !== "hidden" && neuron.type !== "output") continue;
    const slot = SQUASH_SLOT.get(canonicalSquashName(squash)) ??
      SQUASH_OTHER_SLOT;
    vector[slot]++;
  }

  // Fan-in / fan-out per neuron index. Self-loops count on both sides, exactly
  // as they load the neuron at activation time.
  const fanIn = new Int32Array(neuronCount);
  const fanOut = new Int32Array(neuronCount);
  let weightAbsSum = 0;
  let weightSquareSum = 0;
  let weightMaxAbs = 0;
  for (const synapse of synapses) {
    if (synapse.to >= 0 && synapse.to < neuronCount) fanIn[synapse.to]++;
    if (synapse.from >= 0 && synapse.from < neuronCount) fanOut[synapse.from]++;
    const weight = synapse.weight;
    if (!Number.isFinite(weight)) continue;
    const magnitude = Math.abs(weight);
    weightAbsSum += magnitude;
    weightSquareSum += weight * weight;
    if (magnitude > weightMaxAbs) weightMaxAbs = magnitude;
  }

  // Both means are taken over the neurons that actually participate — the ones
  // the arrays above show a non-zero degree for — rather than over a neuron
  // *type* rule. A type rule gets this wrong in both directions: `constant`
  // neurons can never receive and would dilute fan-in, and output neurons *can*
  // emit in a recurrent topology and would be missing from fan-out. Counting
  // what the topology actually did needs no such assumption, and makes the two
  // means genuinely different statistics rather than one number twice.
  let maxFanIn = 0;
  let maxFanOut = 0;
  let receivers = 0;
  let emitters = 0;
  let fanInSum = 0;
  let fanOutSum = 0;
  for (let i = 0; i < neuronCount; i++) {
    const inDegree = fanIn[i];
    const outDegree = fanOut[i];
    if (inDegree > maxFanIn) maxFanIn = inDegree;
    if (outDegree > maxFanOut) maxFanOut = outDegree;
    if (inDegree > 0) {
      receivers++;
      fanInSum += inDegree;
    }
    if (outDegree > 0) {
      emitters++;
      fanOutSum += outDegree;
    }
  }

  let depth = 0;
  for (const layer of computeLayerAssignments(creature).keys()) {
    if (layer > depth) depth = layer;
  }

  const weightMean = synapseCount > 0 ? weightAbsSum / synapseCount : 0;
  // Root mean square, not a standard deviation: the slot beside it is the mean
  // *magnitude*, so a spread measured about the signed mean would not belong to
  // the same family. RMS answers the same question the magnitude penalty asks —
  // how big are these weights — and needs one accumulator, not two passes.
  const weightRms = synapseCount > 0
    ? Math.sqrt(weightSquareSum / synapseCount)
    : 0;

  vector[0] = neuronCount;
  vector[1] = creature.input;
  vector[2] = creature.output;
  vector[3] = hidden;
  vector[4] = constants;
  vector[5] = synapseCount;
  vector[6] = depth;
  vector[7] = receivers > 0 ? fanInSum / receivers : 0;
  vector[8] = maxFanIn;
  vector[9] = emitters > 0 ? fanOutSum / emitters : 0;
  vector[10] = maxFanOut;
  vector[11] = weightMean;
  vector[12] = weightMaxAbs;
  vector[13] = weightRms;
  // Over the neurons that carry a bias, not over every neuron: inputs carry
  // none, so dividing by `neuronCount` scales the slot by the input count
  // rather than reporting a bias magnitude.
  vector[14] = biasedNeurons > 0 ? biasAbsSum / biasedNeurons : 0;
  vector[15] = biasMaxAbs;
  // The sentinel means exactly one thing: no reference was supplied. A
  // creature measured against itself is a genuine zero distance and is
  // reported as one — conflating the two is the mistake the sentinel exists
  // to prevent.
  vector[16] = reference === undefined
    ? NO_REFERENCE_DISTANCE
    : 1 - geneticCompatibility(creature, reference);

  return vector;
}
