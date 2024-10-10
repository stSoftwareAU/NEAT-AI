import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import type { SynapseState } from "../propagate/SynapseState.ts";
import type { CreatureState } from "./CreatureState.ts";
import type { Neuron } from "./Neuron.ts";
import type { Synapse } from "./Synapse.ts";

type BackPropagationArguments = {
  disableRandomSamples: boolean;

  /**
   * The amount of previous generations if not set it'll be a random number between 1-100.
   * The higher number of generations the lower the learning rate
   */
  generations: number;

  /**
   * The learning rate. Between 0..1, Default random number.
   */
  learningRate: number;

  /**
   * The maximum +/- the bias will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumBiasAdjustmentScale: number;

  /**
   * The maximum +/- the weight will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumWeightAdjustmentScale: number;

  /**
   * The limit +/- of the bias, training will not adjust beyond this scale. Default 10_000, Minimum 1
   */
  limitBiasScale: number;

  /**
   * The limit +/- of the weight, training will not adjust beyond this scale. Default 100_000, Minimum 1
   */
  limitWeightScale: number;

  /** When limiting the weight/bias use exponential scaling, Default enabled */
  disableExponentialScaling: boolean;

  /** the minimum unit of weights/biases */
  plankConstant: number;

  /** Probability of changing a gene */
  trainingMutationRate: number;

  excludeSquashList: string;
};

export type BackPropagationOptions = Partial<BackPropagationArguments>;

type BackPropagationConfigArguments =
  & Omit<BackPropagationArguments, "excludeSquashList">
  & {
    /**
     * The actual set of squash genes to exclude.
     */
    excludeSquashSet: Set<string>;
  };

export type BackPropagationConfig = Readonly<BackPropagationConfigArguments>;

export function createBackPropagationConfig(
  options?: BackPropagationOptions | BackPropagationConfig,
): BackPropagationConfig {
  // Check if 'excludeSquashSet' exists to determine if options is BackPropagationConfig
  const isConfig = (
    opts?: BackPropagationOptions | BackPropagationConfig,
  ): opts is BackPropagationConfig => {
    return (opts as BackPropagationConfig)?.excludeSquashSet !== undefined;
  };

  // If options is BackPropagationConfig, use the existing excludeSquashSet, otherwise create a new Set
  const excludeSquashSet = isConfig(options)
    ? options.excludeSquashSet
    : new Set<string>();

  // If excludeSquashList is provided, merge it into the Set
  const excludeSquashList = !isConfig(options)
    ? options?.excludeSquashList
    : undefined;
  if (excludeSquashList) {
    for (const squash of excludeSquashList.split(",")) {
      Activations.find(squash); // Assuming `Activations.find` is a validation function
      excludeSquashSet.add(squash.trim());
    }
  }

  const config: BackPropagationConfigArguments = {
    disableRandomSamples: options?.disableRandomSamples ?? false,

    generations: Math.max(
      options?.generations ?? Math.floor(Math.random() * 100) + 1,
      0,
    ),

    maximumBiasAdjustmentScale: Math.max(
      options?.maximumBiasAdjustmentScale ?? 10,
      0,
    ),

    maximumWeightAdjustmentScale: Math.max(
      options?.maximumWeightAdjustmentScale ?? 10,
      0,
    ),

    limitBiasScale: Math.max(options?.limitBiasScale ?? 10_000, 1),

    limitWeightScale: Math.max(options?.limitWeightScale ?? 100_000, 1),

    learningRate: Math.min(
      Math.max(
        options?.learningRate ?? Math.random(),
        0.01,
      ),
      1,
    ),

    trainingMutationRate: Math.min(
      Math.max(
        options?.trainingMutationRate ?? Math.random(),
        0.01,
      ),
      1,
    ),

    disableExponentialScaling: options?.disableExponentialScaling ?? false,

    plankConstant: options?.plankConstant ?? 0.000_000_1,

    excludeSquashSet, // Use the merged or existing Set
  };

  return Object.freeze(config);
}

export function adjustedBias(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  if (neuron.type == "constant") {
    return neuron.bias;
  } else {
    const ns = neuron.creature.state.node(neuron.index);

    if (!ns.noChange && ns.count) {
      const totalBias = ns.totalBias + (neuron.bias * config.generations);
      const samples = ns.count + config.generations;

      const adjustedBias = totalBias / samples;

      return limitBias(adjustedBias, neuron.bias, config);
    }

    return neuron.bias;
  }
}

export function limitActivationToRange(
  config: BackPropagationConfig,
  neuron: Neuron,
  requestedActivation: number,
) {
  const squash = neuron.findSquash();
  const unSquasher = squash;
  const range = unSquasher.range;

  let limitedActivation: number;

  limitedActivation = Math.min(
    Math.max(requestedActivation, range.low),
    range.high,
  );

  if (range.normalize) {
    limitedActivation = range.normalize(limitedActivation);
  }

  if (
    Math.abs(requestedActivation - limitedActivation) < config.plankConstant &&
    requestedActivation <= range.high &&
    requestedActivation >= range.low
  ) {
    return requestedActivation;
  }

  return limitedActivation;
}

export function toValue(neuron: Neuron, activation: number, hint?: number) {
  if (neuron.type == "input" || neuron.type == "constant") {
    return activation;
  }
  const squash = neuron.findSquash();

  const unSquash = (squash as UnSquashInterface).unSquash;
  if (unSquash !== undefined) {
    const value = unSquash.call(squash, activation, hint);

    return limitValue(value);
  } else {
    return activation;
  }
}
export function toActivation(neuron: Neuron, value: number) {
  const squash = neuron.findSquash();

  const squashedActivation = (squash as ActivationInterface).squash(
    value,
  );

  return limitActivation(squashedActivation);
}

export function accumulateWeight(
  weight: number,
  cs: SynapseState,
  value: number,
  activation: number,
  config: BackPropagationConfig,
) {
  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(value) ||
    !Number.isFinite(activation)
  ) {
    throw new Error(
      `Invalid weight: ${weight}, value: ${value}, activation: ${activation}`,
    );
  }
  if (Math.abs(activation) > config.plankConstant) {
    const targetWeight = value / activation;

    let difference = targetWeight - weight;

    if (!config.disableExponentialScaling) {
      // Squash the difference using the hyperbolic tangent function and scale it
      difference = Math.tanh(difference / config.maximumWeightAdjustmentScale) *
        config.maximumWeightAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      // Limit the difference to the maximum scale
      difference = Math.sign(difference) * config.maximumWeightAdjustmentScale;
    }

    const adjustedWeight = weight + difference;

    cs.averageWeight = ((cs.averageWeight * cs.count) + adjustedWeight) /
      (cs.count + 1);

    cs.count++;
  }
}

export function adjustedWeight(
  creatureState: CreatureState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  const cs = creatureState.connection(c.from, c.to);

  if (cs.count) {
    if (Number.isFinite(cs.averageWeight)) {
      const synapseAverageWeightTotal = cs.averageWeight * cs.count;

      const totalGenerationalWeight = c.weight * config.generations;

      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (cs.count + config.generations);

      return limitWeight(averageWeight, c.weight, config);
    } else {
      throw Error(
        `${c.from}:${c.to}) invalid averageWeight: ${cs.averageWeight} ` +
          JSON.stringify(cs, null, 2),
      );
    }
  }

  return c.weight;
}

export function limitBias(
  targetBias: number,
  currentBias: number,
  config: BackPropagationConfig,
) {
  if (!Number.isFinite(targetBias)) {
    throw new Error(`Bias must be a finite number, got ${targetBias}`);
  }

  if (Math.abs(targetBias) < config.plankConstant) {
    return 0;
  }

  if (Math.abs(targetBias - currentBias) < 0.000_000_001) {
    //288_417_500
    return currentBias;
  }

  const difference = config.learningRate * (targetBias - currentBias);
  const learntBias = currentBias + difference;
  let limitedBias = learntBias;
  if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
    if (difference > 0) {
      limitedBias = currentBias + config.maximumBiasAdjustmentScale;
    } else {
      limitedBias = currentBias - config.maximumBiasAdjustmentScale;
    }
  }

  if (Math.abs(limitedBias) >= config.limitBiasScale) {
    if (limitedBias > 0) {
      if (limitedBias > currentBias) {
        limitedBias = Math.max(currentBias, config.limitBiasScale);
      }
    } else {
      if (limitedBias < currentBias) {
        limitedBias = Math.min(currentBias, config.limitBiasScale * -1);
      }
    }
  }

  return limitedBias;
}

export function limitWeight(
  targetWeight: number,
  currentWeight: number,
  config: BackPropagationConfig,
) {
  if (Math.abs(targetWeight) < config.plankConstant) {
    return 0;
  }

  if (!Number.isFinite(currentWeight)) {
    if (Number.isFinite(targetWeight)) {
      throw new Error(
        `Invalid current: ${currentWeight} returning target: ${targetWeight}`,
      );
    } else {
      throw new Error(
        `Invalid current: ${currentWeight} and target: ${targetWeight} returning zero`,
      );
    }
  }
  if (!Number.isFinite(targetWeight)) {
    throw new Error(
      `Invalid target: ${targetWeight} returning current ${currentWeight}`,
    );
  }

  const difference = config.learningRate * (targetWeight - currentWeight);
  let limitedWeight = currentWeight + difference;
  if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
    if (difference > 0) {
      limitedWeight = currentWeight + config.maximumWeightAdjustmentScale;
    } else {
      limitedWeight = currentWeight - config.maximumWeightAdjustmentScale;
    }
  }
  if (Math.abs(limitedWeight) >= config.limitWeightScale) {
    if (limitedWeight > 0) {
      if (limitedWeight > currentWeight) {
        limitedWeight = Math.max(currentWeight, config.limitWeightScale);
      }
    } else {
      if (limitedWeight < currentWeight) {
        limitedWeight = Math.min(currentWeight, config.limitWeightScale * -1);
      }
    }
  }

  return limitedWeight;
}

export function limitActivation(activation: number) {
  if (activation > 1e12) return 1e12;
  if (activation < -1e12) return -1e12;

  return activation;
}

export function limitValue(value: number) {
  if (value > 1e12) return 1e12;
  if (value < -1e12) return -1e12;

  return value;
}
