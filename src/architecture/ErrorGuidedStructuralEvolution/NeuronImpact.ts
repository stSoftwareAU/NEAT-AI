/**
 * Neuron impact estimation for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Calculates how much each neuron contributes to output error,
 * considering weight paths, activation derivatives, and downstream propagation.
 */
import type { Creature } from "../../Creature.ts";
import { CreatureErrorImpactEstimator } from "../../discovery/NeuronErrorImpactEstimator.ts";
import type { NeuronImpactInfo } from "./DiscoverStructureTypes.ts";

/**
 * Calculates the impact of a neuron on the network outputs.
 * Impact is defined as the maximum weight path to any output neuron,
 * modulated by activation function derivatives.
 *
 * @param creature - The creature containing the neuron
 * @param neuronUUID - The UUID of the neuron to calculate impact for
 * @param neuronImpactEstimator - Estimator instance (will be created if undefined)
 * @param neuronIndexMap - Index map (will be created if undefined)
 * @param derivativeMap - Optional map of average derivatives to account for saturation
 * @returns The impact value (between 0 and 1)
 */
export function calculateNeuronImpact(
  creature: Creature,
  neuronUUID: string,
  neuronImpactEstimator: CreatureErrorImpactEstimator | undefined,
  neuronIndexMap: Map<string, number> | undefined,
  derivativeMap?: Map<string, number>,
): {
  impact: number;
  estimator: CreatureErrorImpactEstimator;
  indexMap: Map<string, number>;
} {
  if (!neuronImpactEstimator) {
    neuronImpactEstimator = new CreatureErrorImpactEstimator(creature);
  }
  if (!neuronIndexMap) {
    neuronIndexMap = new Map<string, number>();
    creature.neurons.forEach((neuron, index) => {
      neuronIndexMap!.set(neuron.uuid, index);
    });
  }
  const share = neuronImpactEstimator.getNeuronShare(neuronUUID);
  if (!Number.isFinite(share) || share <= 0) {
    return {
      impact: 0,
      estimator: neuronImpactEstimator,
      indexMap: neuronIndexMap,
    };
  }
  let derivative = derivativeMap?.get(neuronUUID);
  if (derivative === undefined) {
    derivative = computeSquashDerivative(creature, neuronUUID);
  }
  const derivativeFactor = Number.isFinite(derivative)
    ? Math.max(derivative, 0)
    : 1;
  const downstreamCache = new Map<string, number>();
  const computeDownstreamFactor = (
    uuid: string,
    path: Set<string>,
  ): number => {
    if (downstreamCache.has(uuid)) {
      return downstreamCache.get(uuid)!;
    }
    const index = neuronIndexMap!.get(uuid);
    if (index === undefined) {
      return 1;
    }
    const neuron = creature.neurons[index];
    if (neuron.type === "output") {
      downstreamCache.set(uuid, 1);
      return 1;
    }
    const outward = creature.outwardConnections(index);
    if (!outward || outward.length === 0) {
      downstreamCache.set(uuid, 1);
      return 1;
    }
    let maxProduct = 0;
    for (const synapse of outward) {
      const toNeuron = creature.neurons[synapse.to];
      if (!toNeuron) continue;
      if (path.has(toNeuron.uuid)) {
        continue;
      }
      path.add(toNeuron.uuid);
      const downstreamDerivative = derivativeMap?.get(toNeuron.uuid) ??
        computeSquashDerivative(creature, toNeuron.uuid);
      const childFactor = computeDownstreamFactor(toNeuron.uuid, path);
      path.delete(toNeuron.uuid);
      const product = Math.max(0, downstreamDerivative) * childFactor;
      if (product > maxProduct) {
        maxProduct = product;
      }
    }
    const factor = maxProduct > 0 ? Math.min(1, maxProduct) : 0;
    downstreamCache.set(uuid, factor);
    return factor;
  };

  const downstreamFactor = computeDownstreamFactor(
    neuronUUID,
    new Set<string>([neuronUUID]),
  );

  const impact = Math.min(1, share * derivativeFactor * downstreamFactor);
  return { impact, estimator: neuronImpactEstimator, indexMap: neuronIndexMap };
}

/**
 * Computes the squash function derivative for a neuron at its current activation.
 * Uses the most recent activation from creature.state if available, otherwise returns 1.0.
 *
 * This accounts for saturation effects where neurons operating in saturated regions
 * (e.g., TANH at large inputs) have very small derivatives and thus limited impact
 * on output error regardless of their local error magnitude.
 */
export function computeSquashDerivative(
  creature: Creature,
  neuronUUID: string,
): number {
  const neuron = creature.neurons.find((n) => n.uuid === neuronUUID);
  if (!neuron || neuron.type === "input" || neuron.type === "constant") {
    return 1.0;
  }

  const squashName = neuron.squash ?? "IDENTITY";
  const activation = creature.state.activations[neuron.index];

  if (!Number.isFinite(activation)) {
    return 1.0;
  }

  // Use analytical derivative formulas where possible
  // For TANH: d/dx tanh(x) = 1 - tanh²(x) = 1 - activation²
  // For SIGMOID: d/dx σ(x) = σ(x)(1 - σ(x)) = activation * (1 - activation)
  switch (squashName) {
    case "IDENTITY":
      return 1.0;
    case "TANH": {
      const derivative = 1 - activation * activation;
      return Number.isFinite(derivative) && derivative >= 0 ? derivative : 0;
    }
    case "LOGISTIC":
    case "SIGMOID": {
      const derivative = activation * (1 - activation);
      return Number.isFinite(derivative) && derivative >= 0 ? derivative : 0;
    }
    case "RELU":
      return activation > 0 ? 1.0 : 0.0;
    case "LEAKY_RELU":
      return activation > 0 ? 1.0 : 0.01;
    default:
      // For other activation functions, we cannot easily compute the derivative
      // from just the output, so return 1.0 as a conservative estimate
      return 1.0;
  }
}

/**
 * Lists all selectable neurons sorted by their impact on outputs.
 * Output neurons should always appear at the top.
 */
export function listNeuronsByImpact(
  creature: Creature,
  neuronImpactEstimator: CreatureErrorImpactEstimator | undefined,
  neuronIndexMap: Map<string, number> | undefined,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
): {
  entries: NeuronImpactInfo[];
  estimator: CreatureErrorImpactEstimator;
  indexMap: Map<string, number>;
} {
  let currentEstimator = neuronImpactEstimator;
  let currentIndexMap = neuronIndexMap;

  const entries: NeuronImpactInfo[] = creature.neurons
    .filter((neuron) => neuron.type !== "input" && neuron.type !== "constant")
    .map((neuron) => {
      const result = calculateNeuronImpact(
        creature,
        neuron.uuid,
        currentEstimator,
        currentIndexMap,
      );
      currentEstimator = result.estimator;
      currentIndexMap = result.indexMap;
      return {
        uuid: neuron.uuid,
        neuronType: neuron.type,
        impact: result.impact,
      };
    })
    .map((entry) => ({
      ...entry,
      impact: Number.isFinite(entry.impact) && entry.impact > 0
        ? entry.impact
        : 0,
    }));

  entries.sort((a, b) => {
    const delta = b.impact - a.impact;
    if (Math.abs(delta) > 1e-6) {
      return delta;
    }
    if (a.neuronType !== b.neuronType) {
      return a.neuronType === "output" ? -1 : 1;
    }
    return a.uuid.localeCompare(b.uuid);
  });

  sanityCheckImpactOrdering(creature, entries, logFn);
  return {
    entries,
    estimator: currentEstimator!,
    indexMap: currentIndexMap!,
  };
}

/**
 * Validates output neurons appear at top of impact list.
 */
function sanityCheckImpactOrdering(
  creature: Creature,
  entries: NeuronImpactInfo[],
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
): void {
  const outputCount =
    creature.neurons.filter((n) => n.type === "output").length;
  if (outputCount === 0 || entries.length === 0) {
    return;
  }

  const topSlice = entries.slice(0, Math.min(outputCount, entries.length));
  const violation = topSlice.find((entry) => entry.neuronType !== "output");
  if (violation) {
    const message =
      "Impact ordering sanity check failed: expected output neurons at the top of the list.";
    logFn("error", message, { topSlice });
    throw new Error(message);
  }
}
