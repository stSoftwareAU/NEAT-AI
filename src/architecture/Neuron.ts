import { assert } from "@std/assert/assert";
import { addTags, removeTag, type TagsInterface } from "@stsoftware/tags";
import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { NeuronFixableInterface } from "../methods/activations/NeuronFixableInterface.ts";
import type {
  UnSquashInterface,
} from "../methods/activations/UnSquashInterface.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import {
  type BackPropagationConfig,
  toValue,
} from "../propagate/BackPropagation.ts";
import {
  accumulateBias,
  adjustedBias,
  calculateBias,
} from "../propagate/Bias.ts";
import type { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import {
  accumulateWeight,
  adjustedWeight,
  calculateWeight,
} from "../propagate/Weight.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport, NeuronInternal } from "./NeuronInterfaces.ts";
import { noChangePropagate } from "./NoChangePropagate.ts";
import { Synapse } from "./Synapse.ts";

export class Neuron implements TagsInterface, NeuronInternal {
  readonly creature: Creature;
  readonly type: "input" | "output" | "hidden" | "constant";
  uuid: string;
  bias: number;
  squash?: string;
  private squashMethodCache?:
    | NeuronActivationInterface
    | ActivationInterface;

  public index: number;
  public tags = undefined;

  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    creature: Creature,
    squash?: string,
  ) {
    this.uuid = uuid;
    if (!type) {
      throw new Error("type must be defined: " + (typeof type));
    }
    this.type = type;

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        throw new Error("invalid type: " + type);
      }

      if (bias === undefined) {
        this.bias = Math.random() * 0.2 - 0.1;
      } else {
        if (!Number.isFinite(bias)) {
          throw new Error(
            "bias (other than for 'input') must be a number type: " + type +
              ", typeof: " +
              (typeof bias) + ", value: " + bias,
          );
        }
        this.bias = bias;
      }

      if (type == "constant") {
        if (squash) {
          throw new Error(
            "constants should not a have a squash was: " + squash,
          );
        }
      } else {
        if (squash) this.setSquash(squash);
      }
    } else {
      this.bias = Infinity;
    }

    assert(typeof creature === "object", "network must be a Creature");

    this.creature = creature;

    this.index = -1;
  }

  public validate() {
    if (this.type == "output" || this.type == "hidden") {
      if (!this.squash) {
        throw new Error(`Missing squash for ${this.type} neuron`);
      }

      if (this.squashMethodCache == undefined) {
        throw new Error(
          `Missing squashMethodCache for ${this.type} neuron with squash ${this.squash}`,
        );
      }
      if (this.squashMethodCache.getName() != this.squash) {
        throw new Error(
          `Mismatched squashMethodCache for ${this.type} neuron was ${this.squashMethodCache.getName()} expected ${this.squash}`,
        );
      }
    } else {
      if (this.squash) {
        throw new Error(`Unexpected squash for ${this.type} neuron`);
      }

      if (this.squashMethodCache) {
        throw new Error(`Unexpected squashMethodCache for ${this.type} neuron`);
      }
    }
  }

  private makeFunction() {
    // Generate the function body
    let functionBody = "const state = this.creature.state;\n";
    functionBody += "const activations = state.activations;\n";
    functionBody += `let value = ${this.bias};\n`;

    const inwardList = this.creature.inwardConnections(this.index);
    for (const { from, weight } of inwardList) {
      functionBody += `value += activations[${from}] * ${weight};\n`;
    }

    functionBody += "const activation = this.squashProxy(value);\n";
    functionBody += "activations[this.index] = activation;\n";
    functionBody += "return { activation, value };";

    // Dynamically create the function
    const func = new Function(
      functionBody,
    ) as () => { activation: number; value: number };

    return func;
  }

  /**
   * Updates the cached activation function based on neuron type and squash.
   */
  public prepare():
    | undefined
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (this.type === "constant") {
      this.activateAndTraceNeuron = this.activateConstant;
      this.activateNeuron = this.activateConstant;
    } else if (this.squash) {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        this.activateAndTraceNeuron = this.activateAndTraceNodeActivation;
        this.activateNeuron = this.activateNodeActivation;
        this.activateProxy = squashMethod.activate;
        this.activateAndTraceProxy = squashMethod.activateAndTrace;
      } else {
        this.activateAndTraceNeuron = this.activateAndTraceLinear;

        this.activateNeuron = this.makeFunction();

        const squashActivation = squashMethod as ActivationInterface;
        this.squashProxy = squashActivation.squash;
      }
      return squashMethod;
    }
  }

  ID(): string {
    return this.uuid.substring(Math.max(0, this.uuid.length - 8));
  }

  setSquash(
    name: string,
  ): void {
    delete this.squashMethodCache;
    this.squash = name;
    const squashFunction = this.findSquash();

    this.squash = squashFunction!.getName(); /* Handle aliases */
  }

  findSquash():
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash!,
      );
    }

    return this.squashMethodCache;
  }

  fix() {
    delete this.squashMethodCache;

    if (this.squash !== "IF") {
      const toList = this.creature.inwardConnections(this.index);
      toList.forEach((c) => {
        delete c.type;
      });
    }

    if (this.type == "hidden") {
      const fromList = this.creature.outwardConnections(this.index);
      if (fromList.length == 0) {
        const targetIndx = Math.min(
          1,
          Math.floor(
            Math.random() * (this.creature.nodeCount() - this.index),
          ),
        ) +
          this.index;
        this.creature.connect(
          this.index,
          targetIndx,
          Synapse.randomWeight(),
        );
      }
      const toList = this.creature.inwardConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.creature.connect(
          fromIndx,
          this.index,
          Synapse.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.creature.inwardConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() *
            (this.creature.nodeCount() - this.creature.outputCount()),
        );
        this.creature.connect(
          fromIndx,
          this.index,
          Synapse.randomWeight(),
        );
      }
    }

    if (this.squash) {
      const squashFunction = this.findSquash();

      if (this.isFixableActivation(squashFunction)) {
        squashFunction.fix(this);
      }
    }
  }

  private isNodeActivation(
    activation:
      | NeuronActivationInterface
      | ActivationInterface
      | UnSquashInterface,
  ): activation is NeuronActivationInterface {
    return (activation as NeuronActivationInterface).activateAndTrace !=
      undefined;
  }

  private hasApplyLearnings(
    activation:
      | ApplyLearningsInterface
      | NeuronActivationInterface
      | ActivationInterface
      | UnSquashInterface,
  ): activation is ApplyLearningsInterface {
    return (activation as ApplyLearningsInterface).applyLearnings != undefined;
  }

  private isFixableActivation(
    activation:
      | NeuronActivationInterface
      | ActivationInterface
      | NeuronFixableInterface
      | UnSquashInterface,
  ): activation is NeuronFixableInterface {
    return (activation as NeuronFixableInterface).fix != undefined;
  }

  private activateConstant(): { activation: number; value: number } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.bias;

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateNodeActivation(): { activation: number; value: number } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.activateProxy(this);

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateAndTraceNodeActivation(): {
    activation: number;
    value: number;
  } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.activateAndTraceProxy(this);

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateAndTraceLinear(): { activation: number; value: number } {
    const { activation, value } = this.activateNeuron();
    const state = this.creature.state;
    const ns = state.node(this.index);
    ns.hintValue = value;

    return { activation, value };
  }

  private squashProxy(_value: number): number {
    throw new Error("Not implemented");
  }
  private activateProxy(_neuron: Neuron): number {
    throw new Error("Not implemented");
  }

  private activateAndTraceProxy(_neuron: Neuron): number {
    throw new Error("Not implemented");
  }

  /**
   * Activates the node without calculating eligibility traces and such
   */
  activateNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  /**
   * Activates the node
   */
  activateAndTraceNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  /**
   * Apply the learnings from the previous training.
   * @returns true if changed
   */
  applyLearnings(): boolean {
    const state = this.creature.state;
    const neuronState = state.node(this.index);
    if (neuronState.noChange) return false;
    if (this.type == "hidden" || this.type == "output") {
      const squashMethod = this.findSquash();

      if (this.hasApplyLearnings(squashMethod)) {
        return squashMethod.applyLearnings(this);
      }
    }

    return false;
  }

  propagateUpdate(config: BackPropagationConfig) {
    const state = this.creature.state;
    const toList = this.creature.inwardConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = state.connection(c.from, c.to);
      const aWeight = calculateWeight(cs, c, config);
      c.weight = aWeight;
    }

    const aBias = calculateBias(this, config);

    this.bias = aBias;
  }

  /**
   * Back-propagate the known activation, aka learn
   */
  propagate(
    requestedActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const activation = this.adjustedActivation(config);
    if (
      sparseConfig.propagateNeeded(this.uuid) == false
    ) {
      return activation;
    }
    const squashMethod = this.findSquash();
    const targetActivation = squashMethod.range.limit(requestedActivation);

    const state = this.creature.state;
    if (
      Math.abs(targetActivation - activation) < config.plankConstant
    ) {
      noChangePropagate(this, activation, config);
      state.cacheAdjustedActivation.set(this.index, activation);
      return targetActivation;
    }

    const ns = state.node(this.index);

    const updateNeeded = sparseConfig.updateNeeded(this.uuid);

    /* this node is not changed if the update is not needed */
    ns.noChange = updateNeeded == false;

    let limitedActivation: number;

    const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
    if (propagateUpdateMethod.propagate !== undefined) {
      limitedActivation = propagateUpdateMethod.propagate(
        this,
        targetActivation,
        config,
        sparseConfig,
      );
      // propagateUpdateMethod.range.validate(limitedActivation);
    } else {
      const targetValue = toValue(this, targetActivation, ns.hintValue);

      const currentValue = toValue(this, activation, ns.hintValue);
      const error = targetValue - currentValue;

      const currentBias = adjustedBias(this, config);
      let improvedValue = currentBias;
      const inwardList = this.creature.inwardConnections(this.index);

      const listLength = inwardList.length;

      if (listLength) {
        const indices = Int32Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

        if (!config.disableRandomSamples) {
          CreatureUtil.shuffle(indices);
        }

        const errorPerLink = error / listLength;

        // Iterate over the shuffled indices
        for (let i = listLength; i--;) {
          const indx = indices[i];

          const c = inwardList[indx];

          if (c.from === c.to) continue;

          const fromNeuron = this.creature.neurons[c.from];

          const fromActivation = fromNeuron.adjustedActivation(config);

          const fromWeight = adjustedWeight(state, c, config);
          const fromValue = fromWeight * fromActivation;

          let improvedFromActivation = fromActivation;

          const targetFromValue = fromValue + errorPerLink;

          if (
            fromWeight &&
            fromNeuron.type !== "input" &&
            fromNeuron.type !== "constant"
          ) {
            if (
              sparseConfig.propagateNeeded(fromNeuron.uuid)
            ) {
              const targetFromActivation = targetFromValue / fromWeight;
              improvedFromActivation = fromNeuron.propagate(
                targetFromActivation,
                config,
                sparseConfig,
              );
            }
          }

          if (
            updateNeeded &&
            Math.abs(improvedFromActivation) > config.plankConstant &&
            Math.abs(fromWeight) > config.plankConstant
          ) {
            const cs = state.connection(c.from, c.to);
            accumulateWeight(
              c.weight,
              cs,
              targetFromValue,
              improvedFromActivation,
              config,
            );
            const aWeight = adjustedWeight(state, c, config);

            const improvedFromValue = improvedFromActivation *
              aWeight;

            improvedValue += improvedFromValue;
          }
        }
      }

      if (updateNeeded) {
        accumulateBias(
          ns,
          targetValue,
          improvedValue,
          currentBias,
          config,
        );

        const aBias = adjustedBias(this, config);
        limitedActivation = (squashMethod as ActivationInterface).squash(
          improvedValue + aBias - currentBias,
        );
        // propagateUpdateMethod.range.validate(limitedActivation);
      } else {
        limitedActivation = (squashMethod as ActivationInterface).squash(
          improvedValue,
        );
      }
    }

    if (Math.abs(limitedActivation - activation) > config.plankConstant) {
      if (updateNeeded) {
        ns.traceActivation(limitedActivation);
      }
      state.cacheAdjustedActivation.set(
        this.index,
        limitedActivation,
      );
      return limitedActivation;
    } else {
      state.cacheAdjustedActivation.set(this.index, activation);
      return activation;
    }
  }

  /**
   * Adjusts the activation based on the current state
   */
  adjustedActivation(config: BackPropagationConfig): number {
    const state = this.creature.state;
    const cache = state.cacheAdjustedActivation;
    const cachedValue = cache.get(this.index);

    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const value = this.rawAdjustedActivation(config);

    cache.set(this.index, value);
    return value;
  }

  rawAdjustedActivation(config: BackPropagationConfig): number {
    const state = this.creature.state;
    if (this.type == "input") {
      return state.activations[this.index];
    } else if (this.type == "constant") {
      return this.bias;
    } else {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        const activation = squashMethod.activate(this);
        squashMethod.range.validate(activation);
        return activation;
      } else {
        // All activation sources coming from the node itself

        const toList = this.creature.inwardConnections(this.index);
        const aBias = adjustedBias(this, config);
        let value = aBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          if (c.from == c.to) continue;
          const fromActivation = this.creature.neurons[c.from]
            .adjustedActivation(config);

          const fromWeight = adjustedWeight(
            state,
            c,
            config,
          );

          const fromValue = fromActivation * fromWeight;
          value += fromValue;
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        const activation = activationSquash.squash(value);
        activationSquash.range.validate(activation);

        return activation;
      }
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.creature.disconnect(this.index, to);
    if (twoSided) {
      this.creature.disconnect(to, this.index);
    }
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string): boolean {
    if (typeof method !== "string") {
      throw new Error("Mutate method wrong type: " + (typeof method));
    }
    if (this.type == "input") {
      throw new Error("Mutate on wrong node type: " + this.type);
    }
    let changed = false;
    switch (method) {
      case Mutation.MOD_ACTIVATION.name: {
        switch (this.type) {
          case "hidden":
          case "output":
            break;
          default:
            throw new Error(`Can't modify activation for type ${this.type}`);
        }
        // Can't be the same squash
        for (let attempts = 0; attempts < 12; attempts++) {
          const tmpSquash = Activations
            .NAMES[Math.floor(Math.random() * Activations.NAMES.length)];

          if (tmpSquash != this.squash) {
            this.setSquash(tmpSquash);

            removeTag(this, "CRISPR");
            changed = true;
            break;
          }
        }
        break;
      }
      case Mutation.MOD_BIAS.name: {
        // Calculate the quantum based on the current bias
        const biasMagnitude = Math.abs(this.bias);
        let quantum = 1;

        if (biasMagnitude >= 1) {
          // Find the largest power of 10 smaller than the biasMagnitude
          quantum = Math.pow(10, Math.floor(Math.log10(biasMagnitude)));
        }

        // Generate a random modification value based on the quantum
        const modification = (Math.random() * 2 - 1) * quantum;

        this.bias += modification;
        changed = true;
        break;
      }
      default:
        throw new Error("Unknown mutate method: " + method);
    }
    if (changed) {
      delete this.creature.uuid;
      this.creature.state.preparedNeurons=false;
    }
    return changed;
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Neuron): boolean {
    const c = this.creature.getSynapse(this.index, node.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  exportJSON(): NeuronExport {
    if (this.type === "input") {
      throw new Error(`Should not be exporting 'input'`);
    } else if (this.type === "constant") {
      return {
        type: this.type,
        uuid: this.uuid,
        bias: this.bias,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        type: this.type,
        uuid: this.uuid,
        bias: this.bias,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Converts the node to a json object
   */
  internalJSON(indx: number): NeuronInternal {
    if (this.type === "input") {
      return {
        type: this.type,
        index: indx,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else if (this.type === "constant") {
      return {
        type: this.type,
        index: indx,
        uuid: this.uuid,
        bias: this.bias,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        type: this.type,
        index: indx,
        uuid: this.uuid,
        bias: this.bias,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Convert a json object to a node
   */
  static fromJSON(
    json: NeuronExport | NeuronInternal,
    creature: Creature,
  ): Neuron {
    assert(typeof creature === "object", "network must be a Creature");

    const neuron = new Neuron(
      json.uuid ? json.uuid : crypto.randomUUID(),
      json.type,
      json.bias,
      creature,
    );

    switch (json.type) {
      case "input":
      case "constant":
        break;
      case "output":
      case "hidden":
        if (json.squash) neuron.setSquash(json.squash);
        break;
      default:
        throw new Error("unknown type: " + (json as NeuronInternal).type);
    }

    if (json.tags) {
      addTags(neuron, json);
    }
    return neuron;
  }
}
