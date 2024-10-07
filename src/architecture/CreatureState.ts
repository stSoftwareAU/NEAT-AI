import type { Creature } from "../Creature.ts";
import { SynapseState } from "../propagate/SynapseState.ts";
// import type { BackPropagationConfig } from "./BackPropagation.ts";

export interface NeuronStateInterface {
  count: number;
  totalBias: number;
  hintValue: number;
  // totalBiasDifference: number;
  maximumActivation: number;
  minimumActivation: number;
  noChange?: boolean;
}

export class NeuronState implements NeuronStateInterface {
  public count: number;
  public totalBias: number;
  public hintValue: number;
  /**
   * The maximum activation value for the creature state.
   */
  public maximumActivation: number;
  /**
   * The minimum activation value for the creature state.
   */
  public minimumActivation: number;
  public noChange?: boolean;

  constructor() {
    this.count = 0;
    this.totalBias = 0;
    this.hintValue = 0;
    this.maximumActivation = -Infinity;
    this.minimumActivation = Infinity;
  }

  traceActivation(activation: number) {
    if (activation > this.maximumActivation) {
      this.maximumActivation = activation;
    }

    if (activation < this.minimumActivation) {
      this.minimumActivation = activation;
    }
  }

  accumulateBias(
    targetPreActivationValue: number,
    preActivationValue: number,
    // config: BackPropagationConfig,
    // targetActivation: number,
    // activation: number,
    currentBias: number,
  ) {
    const biasDelta = targetPreActivationValue - preActivationValue;

    // const activationDifference = Math.abs(targetActivation - activation);
    // if (activationDifference < config.plankConstant) {
    //   biasDelta = 0;
    // }
    /* else {
      if (!config.disableExponentialScaling) {
        // Squash the difference using the hyperbolic tangent function and scale it
        biasDelta = Math.tanh(biasDelta / config.maximumBiasAdjustmentScale) *
          config.maximumBiasAdjustmentScale;
      } else if (Math.abs(biasDelta) > config.maximumBiasAdjustmentScale) {
        // Limit the difference to the maximum scale
        biasDelta = Math.sign(biasDelta) * config.maximumBiasAdjustmentScale;
      }
    }*/

    this.count++;
    this.totalBias += currentBias + biasDelta;
    // this.totalBiasDifference += preActivationValue - currentBias;
  }
}

export class CreatureState {
  private nodeMap;
  private connectionMap;
  private network;
  public activations: Float32Array = new Float32Array(0);
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
  }
}
