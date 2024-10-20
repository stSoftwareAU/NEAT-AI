import { assert } from "@std/assert/assert";
import {
  adjustedBias,
  type BackPropagationConfig,
  toValue,
} from "../../../propagate/BackPropagation.ts";
import type { Neuron } from "../../../architecture/Neuron.ts";
import type { SynapseInternal } from "../../../architecture/SynapseInterfaces.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ApplyLearningsInterface } from "../ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../NeuronActivationInterface.ts";
import { IDENTITY } from "../types/IDENTITY.ts";
import { accumulateWeight, adjustedWeight } from "../../../propagate/Weight.ts";

export class MINIMUM
  implements NeuronActivationInterface, ApplyLearningsInterface {
  public static NAME = "MINIMUM";
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return MINIMUM.NAME;
  }

  activate(neuron: Neuron): number {
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let minValue = Number.POSITIVE_INFINITY;
    const activations = neuron.creature.state.activations;
    for (let i = fromList.length; i--;) {
      const c = fromList[i];
      const value = activations[c.from] * c.weight;
      if (value < minValue) {
        minValue = value;
      }
    }

    const value = minValue + neuron.bias;

    return this.range.limit(value);
  }

  activateAndTrace(neuron: Neuron) {
    let minValue = Number.POSITIVE_INFINITY;
    const fromList = neuron.creature.inwardConnections(neuron.index);
    let usedConnection: SynapseInternal | null = null;
    const activations = neuron.creature.state.activations;
    for (let i = fromList.length; i--;) {
      const c = fromList[i];
      const cs = neuron.creature.state.connection(c.from, c.to);
      if (cs.used == undefined) cs.used = false;

      const value = activations[c.from] * c.weight;
      if (value < minValue) {
        minValue = value;
        usedConnection = c;
      }
    }

    if (usedConnection != null) {
      const cs = neuron.creature.state.connection(
        usedConnection.from,
        usedConnection.to,
      );
      cs.used = true;
    }

    const value = minValue + neuron.bias;

    return this.range.limit(value);
  }

  fix(neuron: Neuron) {
    const fromListA = neuron.creature.inwardConnections(neuron.index);
    for (let i = fromListA.length; i--;) {
      const c = fromListA[i];
      if (c.from == c.to) {
        neuron.creature.disconnect(c.from, c.to);
      }
    }

    const fromListB = neuron.creature.inwardConnections(neuron.index);

    switch (fromListB.length) {
      case 1:
        neuron.setSquash(IDENTITY.NAME);
        break;
      case 0:
        neuron.creature.makeRandomConnection(neuron.index);
        break;
    }
  }

  applyLearnings(neuron: Neuron): boolean {
    let changed = false;
    // let usedCount = 0;
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];
      assert(c.to == neuron.index, "mismatched index");
      const cs = neuron.creature.state.connection(c.from, c.to);
      if (!cs.used) {
        neuron.creature.disconnect(c.from, c.to);
        changed = true;
      }
      // else {
      //   usedCount++;
      // }
    }

    // if (usedCount < 2) {
    //   assert(usedCount > 0, "no learnings");

    //   neuron.setSquash(IDENTITY.NAME);

    //   changed = true;
    // }

    return changed;
  }

  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
  ): number {
    const activation = neuron.adjustedActivation(config);

    if (Math.abs(targetActivation - activation) < config.plankConstant) {
      return targetActivation;
    }

    const inward = neuron.creature.inwardConnections(neuron.index);
    const targetValue = toValue(neuron, targetActivation);

    const activationValue = toValue(neuron, activation);

    const error = targetValue - activationValue;
    let remainingError = error;
    const currentBias = adjustedBias(neuron, config);
    let improvedValue = 0;
    if (inward.length) {
      let minValue = Infinity;

      let mainConnection;
      let mainActivation;
      for (let indx = inward.length; indx--;) {
        const c = inward[indx];

        const fromNeuron = neuron.creature.neurons[c.from];

        const fromActivation = fromNeuron.adjustedActivation(config);

        const fromWeight = adjustedWeight(neuron.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;
        if (fromValue < minValue) {
          minValue = fromValue;
          mainConnection = c;
          mainActivation = fromActivation;
        }
      }

      assert(mainConnection != undefined);
      for (let indx = inward.length; indx--;) {
        const c = inward[indx];

        if (c !== mainConnection) {
          const fromNeuron = neuron.creature.neurons[c.from];

          const fromActivation = fromNeuron.adjustedActivation(config);

          /** No Change Propagate */
          if (fromNeuron.type !== "input" && fromNeuron.type !== "constant") {
            if (c.from != c.to) {
              fromNeuron.propagate(fromActivation, config);
            }
          }

          const fromWeight = adjustedWeight(neuron.creature.state, c, config);
          const fromValue = fromWeight * fromActivation;

          const cs = neuron.creature.state.connection(c.from, c.to);
          accumulateWeight(
            c.weight,
            cs,
            fromValue,
            fromActivation,
            config,
          );
        }
      }

      assert(mainActivation != undefined);
      const fromNeuron = neuron.creature.neurons[mainConnection.from];

      const fromWeight = adjustedWeight(
        neuron.creature.state,
        mainConnection,
        config,
      );
      const fromValue = fromWeight * mainActivation;

      let improvedFromActivation = mainActivation;
      let targetFromActivation = mainActivation;
      const targetFromValue = fromValue + error;
      if (
        fromWeight &&
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        targetFromActivation = targetFromValue / fromWeight;

        if (mainConnection.from != mainConnection.to) {
          improvedFromActivation = fromNeuron.propagate(
            targetFromActivation,
            config,
          );
        }

        const improvedFromValue = improvedFromActivation * fromWeight;

        remainingError = targetFromValue - improvedFromValue;
      }

      const targetFromValue2 = fromValue + remainingError;

      const cs = neuron.creature.state.connection(
        mainConnection.from,
        mainConnection.to,
      );
      accumulateWeight(
        mainConnection.weight,
        cs,
        targetFromValue2,
        targetFromActivation,
        config,
      );

      const aWeight = adjustedWeight(
        neuron.creature.state,
        mainConnection,
        config,
      );

      const improvedAdjustedFromValue = improvedFromActivation *
        aWeight;

      improvedValue = improvedAdjustedFromValue + currentBias;
    }

    const ns = neuron.creature.state.node(neuron.index);
    ns.accumulateBias(
      targetValue,
      improvedValue,
      currentBias,
    );

    const aBias = adjustedBias(neuron, config);

    const adjustedActivation = improvedValue - currentBias + aBias;

    return adjustedActivation;
  }
}
