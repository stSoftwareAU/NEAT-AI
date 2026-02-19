import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { BackpropBuffers } from "../propagate/BackpropBuffers.ts";
import { SynapseState } from "../propagate/SynapseState.ts";
import { DenseNumberMap } from "./DenseNumberMap.ts";

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

  /**
   * Resets all fields to their default values in place,
   * avoiding the need to allocate a new NeuronState object.
   * Issue #1537: In-place reset for flat array storage.
   */
  reset() {
    this.count = 0;
    this.totalBias = 0;
    this.totalAdjustedBias = 0;
    this.batchBias = undefined;
    this.hintValue = 0;
    this.maximumActivation = -Infinity;
    this.minimumActivation = Infinity;
    this.totalActivation = 0;
    this.noChange = undefined;
    this.totalErrorAbsolute = 0;
  }

  /**
   * Traces an activation value, updating the min/max and total.
   *
   * Issue #1314 - Non-finite activation values are skipped to prevent
   * corruption of the state. This protects against Infinity, -Infinity,
   * and NaN values propagating through the network.
   */
  traceActivation(activation: number) {
    // Issue #1314: Skip non-finite values to prevent state corruption
    if (!Number.isFinite(activation)) {
      return;
    }

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
  /**
   * Pre-allocated flat array of NeuronState objects indexed by neuron position.
   * Issue #1537: Replaces Map<number, NeuronState> for O(1) access without
   * hashing overhead. Array elements are reset in place via NeuronState.reset().
   */
  private nodeArray: NeuronState[];
  private connectionMap;
  private creature;
  public activations: Float32Array = new Float32Array(0);
  /**
   * Cache for adjusted activation values per neuron index.
   * Uses TypedArray-backed storage for better cache locality with dense indices.
   * Issue #1041: Use TypedArray for dense neuron state storage.
   */
  readonly cacheAdjustedActivation: DenseNumberMap;
  /**
   * Issue #1379: Pre-allocated reusable buffers for backward pass.
   * Lazily initialised on first backward pass to avoid overhead for
   * creatures that are only used for forward activation (evaluation).
   */
  backpropBuffers?: BackpropBuffers;
  public preparedNeurons = false;

  constructor(creature: Creature) {
    this.creature = creature;
    const neuronCount = creature.neurons?.length ?? 0;
    this.nodeArray = new Array<NeuronState>(neuronCount);
    for (let i = 0; i < neuronCount; i++) {
      this.nodeArray[i] = new NeuronState();
    }
    this.connectionMap = new Map<number, Map<number, SynapseState>>();
    // Start with a reasonable default size that will auto-resize if needed.
    // The creature's neurons array may not be populated yet at construction time
    // (class properties are initialised before the constructor runs).
    const initialCapacity = neuronCount || 16;
    this.cacheAdjustedActivation = new DenseNumberMap(initialCapacity);
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
    let state = this.nodeArray[indx];
    if (state !== undefined) {
      return state;
    }
    // Grow the array if the index is beyond the pre-allocated size
    state = new NeuronState();
    this.nodeArray[indx] = state;
    return state;
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

  /**
   * Collects per-neuron error data for error-guided sparse selection.
   * Returns a map from neuron UUID to NeuronStateInterface.
   * Issue #1388: Error-guided sparse neuron selection.
   */
  collectNeuronErrors(): Map<string, NeuronStateInterface> {
    const errors = new Map<string, NeuronStateInterface>();
    const len = this.nodeArray.length;
    for (let i = 0; i < len; i++) {
      const state = this.nodeArray[i];
      if (state !== undefined && state.totalErrorAbsolute > 0) {
        const neuron = this.creature.neurons[i];
        if (neuron && neuron.uuid) {
          errors.set(neuron.uuid, state);
        }
      }
    }
    return errors;
  }

  clear() {
    this.preparedNeurons = false;
    // Replace each NeuronState with a fresh instance rather than resetting
    // in place. External code (e.g. traceJSON) may hold references to the
    // old NeuronState objects and expects their accumulated values to remain.
    // Issue #1537: Flat array still provides O(1) lookup without Map hashing.
    const len = this.nodeArray.length;
    for (let i = 0; i < len; i++) {
      this.nodeArray[i] = new NeuronState();
    }
    this.connectionMap.clear();
  }
}
