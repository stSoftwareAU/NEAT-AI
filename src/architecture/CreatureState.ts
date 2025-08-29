import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import { SynapseState } from "../propagate/SynapseState.ts";

export interface NeuronStateInterface {
  count: number;
  totalBias: number;
  totalAdjustedBias: number;
  hintValue: number;

  maximumActivation: number;
  minimumActivation: number;
  totalActivation?: number;
  noChange?: boolean;
  totalErrorAbsolute?: number;
}

export class NeuronState implements NeuronStateInterface {
  public count: number;
  public totalBias: number;
  public totalAdjustedBias: number;
  public batchBias?: number;
  public hintValue: number;
  /**
   * The maximum activation value for the creature state.
   */
  public maximumActivation: number;
  /**
   * The minimum activation value for the creature state.
   */
  public minimumActivation: number;
  public totalActivation: number;

  public noChange?: boolean;
  public totalErrorAbsolute: number;

  constructor() {
    this.count = 0;
    this.totalBias = 0;
    this.totalAdjustedBias = 0;
    this.hintValue = 0;
    this.maximumActivation = -Infinity;
    this.minimumActivation = Infinity;
    this.totalActivation = 0;
    this.totalErrorAbsolute = 0;
  }

  traceActivation(activation: number) {
    if (activation > this.maximumActivation) {
      this.maximumActivation = activation;
    }

    if (activation < this.minimumActivation) {
      this.minimumActivation = activation;
    }
    this.totalActivation += activation;
  }
}

export class CreatureState {
  private nodeMap;
  private connectionMap;
  private creature;
  public activations: Float32Array = new Float32Array(0);
  readonly cacheAdjustedActivation: Map<number, number>;
  public preparedNeurons = false;

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

  makeActivation(input: Float32Array, feedbackLoop: boolean): Float32Array {
    if (
      this.activations.length !== this.creature.neurons.length
    ) {
      this.activations = new Float32Array(this.creature.neurons.length);
    } else if (feedbackLoop === false) {
      this.activations.fill(0, input.length);
    }
    assert(input.length === this.creature.input, "Invalid input length");
    this.activations.set(input);

    return this.activations;
  }

  clear() {
    this.preparedNeurons = false;
    this.nodeMap.clear();
    this.connectionMap.clear();
  }
}
