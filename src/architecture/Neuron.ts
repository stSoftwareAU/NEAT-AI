/**
 * Neuron.ts - Central class for neurons in NEAT neural networks.
 *
 * Issue #1599: Refactored from 1,339 lines into a ~250-line facade.
 * Responsibilities are delegated to focused modules in src/neuron/:
 * - NeuronActivation.ts    - Activation function management and computation
 * - NeuronPropagation.ts   - Backpropagation and error distribution
 * - NeuronRecord.ts        - Error recording for structural discovery
 * - NeuronTopology.ts      - Topology fixing, mutation, and connectivity
 * - NeuronSerialization.ts - JSON import/export
 */

import { addTags, type TagsInterface } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import type { FunctionCache } from "../optimize/FunctionCache.ts";
import type { BackPropagationConfig } from "../propagate/BackPropagation.ts";
import type { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import { getSquashType } from "../wasm/SquashType.ts";
import type { DiscoverRecord } from "./ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { NeuronExport, NeuronInternal } from "./NeuronInterfaces.ts";

// Extracted modules
import * as activation from "../neuron/NeuronActivation.ts";
import * as propagation from "../neuron/NeuronPropagation.ts";
import * as recording from "../neuron/NeuronRecord.ts";
import * as topology from "../neuron/NeuronTopology.ts";
import * as serialisation from "../neuron/NeuronSerialization.ts";

/**
 * Represents a neuron in a neural network.
 *
 * A neuron is a computational unit that receives inputs, applies an activation function,
 * and produces an output. Neurons can be of different types (input, hidden, output, constant)
 * and can have various activation functions applied to them.
 *
 * @example
 * ```ts
 * const neuron = new Neuron("hidden-1", "hidden", 0.5, creature, "TANH");
 * neuron.activateNeuron();
 * ```
 */
export class Neuron implements TagsInterface, NeuronInternal {
  /** Reference to the parent creature */
  readonly creature: Creature;
  /** Type of the neuron (input, output, hidden, or constant) */
  type: "input" | "output" | "hidden" | "constant";
  /** Unique identifier for the neuron */
  uuid: string;
  /** Bias value added to the neuron's input */
  bias: number;
  /** Name of the activation function to apply */
  squash?: string;
  /** Cached activation function instance for performance */
  private squashMethodCache?:
    | NeuronActivationInterface
    | ActivationInterface;

  /**
   * Cached complexity penalty for score calculation.
   * Issue #1043: Cache Activations.find() lookups in score calculation.
   * Invalidated when squash function changes via setSquash().
   */
  private complexityPenaltyCache?: number;

  /**
   * Cached SquashType enum value for this neuron's squash function.
   * Issue #1378: Pre-compute squash type indices to avoid repeated
   * getSquashType() string-to-enum lookups during backpropagation.
   * Invalidated when squash function changes via setSquash().
   */
  private squashTypeCache?: number;

  /** Index position of the neuron in the creature's neuron array */
  public index: number;
  /** Tags for storing metadata about the neuron */
  public tags = undefined;

  /** Function cache for activation computation */
  private functionCache: FunctionCache = { key: "" };

  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number,
    creature: Creature,
    squash?: string,
  ) {
    this.uuid = uuid;
    this.type = type;

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        throw new TopologyError("invalid type: " + type, "INVALID_NEURON_TYPE");
      }

      this.bias = bias;

      if (type === "constant") {
        if (squash) {
          throw new TopologyError(
            "constants should not have a squash was: " + squash,
            "INVALID_SQUASH",
          );
        }
      } else {
        if (squash) {
          this.squash = squash;
        } else {
          this.squash = Activations.pickRandomSquash();
        }
      }
    } else {
      this.bias = Infinity;
    }

    this.creature = creature;
    this.index = -1;
  }

  public validate() {
    if (this.type === "output" || this.type === "hidden") {
      if (!this.squash) {
        throw new TopologyError(
          `Missing squash for ${this.type} neuron`,
          "MISSING_SQUASH",
        );
      }
    } else {
      if (this.squash) {
        throw new TopologyError(
          `Unexpected squash for ${this.type} neuron`,
          "INVALID_SQUASH",
        );
      }

      if (this.squashMethodCache) {
        throw new TopologyError(
          `Unexpected squashMethodCache for ${this.type} neuron`,
          "INVALID_STATE",
        );
      }
    }
  }

  ID(): string {
    return this.uuid.substring(Math.max(0, this.uuid.length - 8));
  }

  setSquash(name?: string): void {
    if (name !== this.squash) {
      delete this.squashMethodCache;
      delete this.complexityPenaltyCache;
      delete this.squashTypeCache;
      this.squash = name;
      // Invalidate creature's score cache since complexity penalty may have changed
      // Issue #1043: Cache Activations.find() lookups in score calculation
      this.creature.invalidateScoreCache();
    }
  }

  getComplexityPenalty(): number {
    if (this.type === "input" || this.type === "constant") {
      return 0;
    }
    if (this.complexityPenaltyCache !== undefined) {
      return this.complexityPenaltyCache;
    }
    if (this.squash) {
      const squashFunction = this.findSquash();
      this.complexityPenaltyCache = squashFunction.complexityPenalty ?? 0;
    } else {
      this.complexityPenaltyCache = 0;
    }
    return this.complexityPenaltyCache;
  }

  cachedSquashType(): number {
    if (this.squashTypeCache !== undefined) {
      return this.squashTypeCache;
    }
    this.squashTypeCache = getSquashType(this.squash);
    return this.squashTypeCache;
  }

  findSquash():
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash!,
      ) as NeuronActivationInterface | ActivationInterface;
      this.squash = this.squashMethodCache.getName(); /* Handle aliases */
    }
    return this.squashMethodCache;
  }

  // --- Delegated methods ---

  public prepare():
    | undefined
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    return activation.prepare(this, this.functionCache);
  }

  fix() {
    topology.fix(this);
  }

  activateNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  activateAndTraceNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  applyLearnings(): boolean {
    return activation.applyLearnings(this);
  }

  propagateUpdate(config: BackPropagationConfig) {
    propagation.propagateUpdate(this, config);
  }

  propagate(
    requestedActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    return propagation.propagate(
      this,
      requestedActivation,
      config,
      sparseConfig,
    );
  }

  record(
    requestedActivation: number,
    discoverMap: Map<string, DiscoverRecord>,
  ): void {
    recording.record(this, requestedActivation, discoverMap);
  }

  adjustedActivation(config: BackPropagationConfig): number {
    return propagation.adjustedActivation(this, config);
  }

  rawAdjustedActivation(config: BackPropagationConfig): number {
    return propagation.rawAdjustedActivation(this, config);
  }

  disconnect(to: number, twoSided: boolean) {
    this.creature.disconnect(this.index, to);
    if (twoSided) {
      this.creature.disconnect(to, this.index);
    }
  }

  mutate(method: string): boolean {
    return topology.mutate(this, method);
  }

  isProjectingTo(node: Neuron): boolean {
    const c = this.creature.getSynapse(this.index, node.index);
    return c !== null;
  }

  exportJSON(): NeuronExport {
    return serialisation.exportJSON(this);
  }

  internalJSON(indx: number): NeuronInternal {
    return serialisation.internalJSON(this, indx);
  }

  static fromJSON(
    json: NeuronExport | NeuronInternal,
    creature: Creature,
  ): Neuron {
    return serialisation.fromJSON(json, creature);
  }
}
