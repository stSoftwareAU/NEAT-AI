import type { CreatureState } from "../architecture/CreatureState.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";
import type { SynapseState } from "./SynapseState.ts";

export function accumulateWeight(
  currentWeight: number,
  cs: SynapseState,
  targetValue: number,
  activation: number,
  config: BackPropagationConfig,
) {
  cs.totalValue += targetValue;
  cs.totalActivation += activation;

  const sign = activation != 0 ? Math.sign(activation) : 1;
  let tmpActivation = activation;

  if (Math.abs(activation) < config.plankConstant) {
    tmpActivation = config.plankConstant * sign;
  }

  const tmpValue = Math.abs(targetValue) > config.plankConstant
    ? targetValue
    : config.plankConstant * Math.sign(targetValue);
  const tmpWeight = tmpValue / tmpActivation;
  // const weightDifference = tmpWeight - weight;
  // if (Math.abs(weightDifference) > config.maximumWeightAdjustmentScale) {

  //   const holdWeight = tmpWeight;
  //   tmpWeight = Math.sign(weightDifference) * config.maximumWeightAdjustmentScale + weight;
  //   console.log(`restrict weight: ${holdWeight}, Difference: ${weightDifference} adjusted: ${tmpWeight} current: ${weight}`);
  // }
  // console.log(`tmpWeight: ${tmpWeight} value: ${value} activation: ${activation}, adjusted activation: ${tmpActivation}, plankConstant: ${config.plankConstant}, sign: ${sign}`);

  const adjustedLimitedWeight = limitWeight(tmpWeight, currentWeight, config);
  cs.totalAdjustedValue += adjustedLimitedWeight * tmpActivation;
  cs.totalAdjustedActivation += tmpActivation;

  if (Math.abs(activation) > config.plankConstant) {
    const targetWeight = targetValue / activation;

    let difference = targetWeight - currentWeight;

    if (!config.disableExponentialScaling) {
      // Squash the difference using the hyperbolic tangent function and scale it
      difference = Math.tanh(difference / config.maximumWeightAdjustmentScale) *
        config.maximumWeightAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      // Limit the difference to the maximum scale
      difference = Math.sign(difference) * config.maximumWeightAdjustmentScale;
    }

    const adjustedWeight = currentWeight + difference;

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
    //AAAAAAAA
    if (Math.abs(cs.totalAdjustedActivation) > config.plankConstant) {
      const synapseAverageWeight = cs.totalAdjustedValue /
        cs.totalAdjustedActivation;

      // if(true) return synapseAverageWeight;
      const synapseAverageWeightTotal = synapseAverageWeight * cs.count;

      const generations = config.generations;
      const totalGenerationalWeight = c.weight * generations;

      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (cs.count + generations);

      const limitedWeight = limitWeight(averageWeight, c.weight, config);
      return limitedWeight;
    }
    //BBBBB
    // if( Math.abs(cs.totalActivation) > config.plankConstant){
    //   const synapseAverageWeight = cs.totalValue/ cs.totalActivation;
    //   const limitedWeight = limitWeight(synapseAverageWeight, c.weight, config);
    //   return limitedWeight;
    // }
    //CCCCC
    // const synapseAverageWeightTotal = cs.averageWeight * cs.count;

    // const generations = config.generations;
    // const totalGenerationalWeight = c.weight * generations;

    // const averageWeight =
    //   (synapseAverageWeightTotal + totalGenerationalWeight) /
    //   (cs.count + generations);

    // const limitedWeight = limitWeight(averageWeight, c.weight, config);
    // return limitedWeight;
  }

  return c.weight;
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
