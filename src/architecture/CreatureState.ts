import { Creature } from "../Creature.ts";
import { BackPropagationConfig } from "./BackPropagation.ts";

export interface NeuronStateInterface {
  count: number;
  totalValue: number;
  totalWeightedSum: number;
  maximumActivation: number;
  minimumActivation: number;
}

export class NeuronState implements NeuronStateInterface {
  count = 0;

  totalValue = 0;
  totalWeightedSum = 0;
  /**
   * The maximum activation value for the creature state.
   */
  maximumActivation = -Infinity;
  /**
   * The minimum activation value for the creature state.
   */
  minimumActivation = Infinity;

  traceActivation(activation: number) {
    if (activation > this.maximumActivation) {
      this.maximumActivation = activation;
    }

    if (activation < this.minimumActivation) {
      this.minimumActivation = activation;
    }
  }

  accumulateBias(
    targetValue: number,
    value: number,
    config: BackPropagationConfig,
    targetActivation: number,
    activation: number,
    currentBias: number,
  ) {
    let difference = targetValue - value;

    const activationDifference = Math.abs(targetActivation - activation);
    if (activationDifference < config.plankConstant) {
      difference = 0;
    } //else {
    // const activationPercent = activationDifference /
    //   Math.max(Math.abs(targetActivation), Math.abs(activation));
    // const valuePercent = Math.abs(difference) /
    //   Math.max(Math.abs(targetValue), Math.abs(value));

    // if (activationPercent > valuePercent) {
    //   const originalDifference = difference;
    //   const adjustPercent = valuePercent / activationPercent;
    //   difference = originalDifference * adjustPercent;
    // console.info(
    //   `restrict ${originalDifference} to ${difference} as activation percentage ${
    //     activationPercent.toFixed(3)
    //   } versus ${valuePercent.toFixed(3)} adjustPercent ${
    //     adjustPercent.toFixed(3)
    //   }`,
    // );
    // }
    // }

    // if (Math.abs(difference) > PLANK_CONSTANT) {
    //   console.info(
    //     `difference ${difference} targetValue ${targetValue} value ${value} targetActivation ${targetActivation} activation ${activation}`,
    //   );
    // }

    if (!config.disableExponentialScaling) {
      // Squash the difference using the hyperbolic tangent function and scale it
      difference = Math.tanh(difference / config.maximumBiasAdjustmentScale) *
        config.maximumBiasAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
      // Limit the difference to the maximum scale
      difference = Math.sign(difference) * config.maximumBiasAdjustmentScale;
    }

    this.count++;
    this.totalValue += value + difference;
    this.totalWeightedSum += value - currentBias;
  }
}

export class SynapseState {
  count = 0;

  averageWeight = 0;
  public used?: boolean;
}

export class CreatureState {
  private nodeMap;
  private connectionMap;
  private network;
  public activations: number[] = [];
  public propagated = false;

  constructor(network: Creature) {
    this.network = network;
    this.nodeMap = new Map<number, NeuronState>();
    this.connectionMap = new Map<number, Map<number, SynapseState>>();
  }

  connection(from: number, to: number): SynapseState {
    let fromMap = this.connectionMap.get(from);
    if (fromMap === undefined) {
      fromMap = new Map<number, SynapseState>();
      this.connectionMap.set(from, fromMap);
    }
    const state = fromMap.get(to);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new SynapseState();

      fromMap.set(to, tmpState);
      return tmpState;
    }
  }

  node(indx: number): NeuronState {
    const state = this.nodeMap.get(indx);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new NeuronState();

      this.nodeMap.set(indx, tmpState);
      return tmpState;
    }
  }

  makeActivation(input: number[], feedbackLoop: boolean) {
    if (this.activations.length == 0 || feedbackLoop == false) {
      this.activations = input.slice();
      this.activations.length = this.network.neurons.length;
      this.activations.fill(0, input.length);
    } else if (feedbackLoop) {
      /** Leave the results from last run */
      const rightArray = this.activations.slice(input.length);
      this.activations = input.concat(rightArray);
    }
  }

  clear() {
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.activations.length = 0;
    this.propagated = false;
  }
}
