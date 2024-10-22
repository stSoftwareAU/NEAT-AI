import type { Creature } from "../Creature.ts";
import { SynapseState } from "../propagate/SynapseState.ts";

export interface NeuronStateInterface {
  count: number;
  totalBias: number;
  hintValue: number;

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
}

export class CreatureState {
  private nodeMap;
  private connectionMap;
  private creature;
  public activations: Float32Array = new Float32Array(0);
  readonly cacheAdjustedActivation: Map<number, number>;

  constructor(creature: Creature) {
    this.creature = creature;
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
    if (
      feedbackLoop == false ||
      this.activations.length !== this.creature.neurons.length
    ) {
      this.activations = new Float32Array(this.creature.neurons.length);
    }

    try {
      this.activations.set(input);
    } catch (e) {
      const msg =
        `input length ${input.length} does fit with activation array ${this.activations.length}, neurons: ${this.creature.neurons.length}`;

      throw new Error(msg, { cause: e });
    }
  }

  clear() {
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.activations = new Float32Array(0);
  }
}
