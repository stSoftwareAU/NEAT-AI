import type { Creature } from "../Creature.ts";
import { SynapseState } from "../propagate/SynapseState.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";

export interface NeuronStateInterface {
  count: number;
  totalValue: number;
  hintValue: number;
  totalWeightedSum: number;
  maximumActivation: number;
  minimumActivation: number;
}

export class NeuronState implements NeuronStateInterface {
  count = 0;

  totalValue = 0;
  hintValue = 0;
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
    } else {
      if (!config.disableExponentialScaling) {
        // Squash the difference using the hyperbolic tangent function and scale it
        difference = Math.tanh(difference / config.maximumBiasAdjustmentScale) *
          config.maximumBiasAdjustmentScale;
      } else if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
        // Limit the difference to the maximum scale
        difference = Math.sign(difference) * config.maximumBiasAdjustmentScale;
      }
    }

    this.count++;
    this.totalValue += value + difference;
    this.totalWeightedSum += value - currentBias;
  }
}

export class CreatureState {
  private nodeMap;
  private connectionMap;
  private network;
  public activations: Float32Array = new Float32Array(0);
  public propagated = false;
  readonly cacheAdjustedActivation: Map<number, number>;

  constructor(network: Creature) {
    this.network = network;
    this.nodeMap = new Map<number, NeuronState>();
    this.connectionMap = new Map<number, Map<number, SynapseState>>();
    this.cacheAdjustedActivation = new Map<number, number>();
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
    if (feedbackLoop == false || this.activations.length == 0) {
      this.activations = new Float32Array(this.network.neurons.length);
    }

    try {
      this.activations.set(input);
    } catch (e) {
      const msg =
        `input length ${input.length} does fit with activation array ${this.activations.length}, neurons: ${this.network.neurons.length}`;

      throw new Error(msg, { cause: e });
    }
  }

  clear() {
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.activations = new Float32Array(0);
    this.propagated = false;
  }
}
