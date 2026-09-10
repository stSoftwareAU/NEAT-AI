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
 * in `test/archive/EvaluationDescriptorReproducibility.ts` meaningful.
 *
 * @module EvaluationDescriptor
 */

import type { Creature } from "@creature";
import { Activations } from "@methods/activations/Activations.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

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

/**
 * Canonicalise a squash name so aliases (`RELU` / `ReLU`) share a slot.
 *
 * An activation the registry cannot resolve is a separate bug; it keeps its raw
 * name here so it lands in `squash:other` and stays visible, rather than being
 * dropped.
 */
function canonicalSquashName(squash: string): string {
  try {
    return Activations.find(squash).getName();
  } catch {
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
  for (const neuron of neurons) {
    if (neuron.type === "hidden") hidden++;
    else if (neuron.type === "constant") constants++;

    const bias = neuron.bias;
    if (typeof bias === "number" && Number.isFinite(bias)) {
      const magnitude = Math.abs(bias);
      biasAbsSum += magnitude;
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

  let maxFanIn = 0;
  let maxFanOut = 0;
  for (let i = 0; i < neuronCount; i++) {
    if (fanIn[i] > maxFanIn) maxFanIn = fanIn[i];
    if (fanOut[i] > maxFanOut) maxFanOut = fanOut[i];
  }

  // Mean fan-in and fan-out both sum to the synapse count, so they differ only
  // in their denominator: fan-in is per receiving neuron (non-input), fan-out
  // per emitting neuron (non-output).
  const fanInDenominator = neuronCount - creature.input;
  const fanOutDenominator = neuronCount - creature.output;

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
  vector[7] = fanInDenominator > 0 ? synapseCount / fanInDenominator : 0;
  vector[8] = maxFanIn;
  vector[9] = fanOutDenominator > 0 ? synapseCount / fanOutDenominator : 0;
  vector[10] = maxFanOut;
  vector[11] = weightMean;
  vector[12] = weightMaxAbs;
  vector[13] = weightRms;
  vector[14] = neuronCount > 0 ? biasAbsSum / neuronCount : 0;
  vector[15] = biasMaxAbs;
  vector[16] = reference === undefined || reference === creature
    ? NO_REFERENCE_DISTANCE
    : 1 - geneticCompatibility(creature, reference);

  return vector;
}
