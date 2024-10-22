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
import { accumulateBias, adjustedBias } from "../propagate/Bias.ts";
import {
  accumulateWeight,
  adjustedWeight,
  calculateWeight,
} from "../propagate/Weight.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import type { NeuronExport, NeuronInternal } from "./NeuronInterfaces.ts";
import { noChangePropagate } from "./NoChangePropagate.ts";
import { Synapse } from "./Synapse.ts";
import { assert } from "@std/assert/assert";

export class Neuron implements TagsInterface, NeuronInternal {
  readonly creature: Creature;
  readonly type: "input" | "output" | "hidden" | "constant";
  uuid: string;
  bias: number;
  squash?: string;
  private squashMethodCache?:
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface;
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
        this.squash = squash;
      }
    } else {
      this.bias = Infinity;
    }

    assert(typeof creature === "object", "network must be a Creature");

    this.creature = creature;

    this.type = type;

    this.index = -1;
  }

  ID(): string {
    return this.uuid.substring(Math.max(0, this.uuid.length - 8));
  }

  setSquash(
    name: string,
  ): NeuronActivationInterface | ActivationInterface | UnSquashInterface {
    if (this.type == "constant") {
      throw new Error("Can't set the squash of a constant");
    }
    delete this.squashMethodCache;
    this.squash = name;
    return this.findSquash();
  }

  findSquash():
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash ? this.squash : `UNDEFINED-${this.type}-${this.index}`,
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
      this.squash = squashFunction.getName();
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

  /**
   * Activates the node
   */
  activateAndTrace(): number {
    const activations = this.creature.state.activations;
    let activation: number;
    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();

      if (this.isNodeActivation(squashMethod)) {
        activation = squashMethod.activateAndTrace(this);
      } else {
        const toList = this.creature.inwardConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];

          const fromActivation = activations[c.from];
          value += fromActivation * c.weight;
        }

        const ns = this.creature.state.node(this.index);
        ns.hintValue = value;
        const activationSquash = squashMethod as ActivationInterface;
        activation = activationSquash.squash(value);
      }
      squashMethod.range.validate(activation);
    }

    activations[this.index] = activation;
    return activation;
  }

  /**
   * Apply the learnings from the previous training.
   * @returns true if changed
   */
  applyLearnings(): boolean {
    const neuronState = this.creature.state.node(this.index);
    if (neuronState.noChange) return false;
    if (this.type == "hidden" || this.type == "output") {
      const squashMethod = this.findSquash();

      if (this.hasApplyLearnings(squashMethod)) {
        return squashMethod.applyLearnings(this);
      }
    }

    return false;
  }

  /**
   * Activates the node without calculating eligibility traces and such
   */
  activate(): number {
    const activations = this.creature.state.activations;
    let activation: number;
    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        activation = squashMethod.activate(this);
      } else {
        // All activation sources coming from the node itself

        const toList = this.creature.inwardConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];

          const fromActivation = activations[c.from];
          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        activation = activationSquash.squash(value);
      }
      squashMethod.range.validate(activation);
    }

    activations[this.index] = activation;
    return activation;
  }

  propagateUpdate(config: BackPropagationConfig) {
    const toList = this.creature.inwardConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = this.creature.state.connection(c.from, c.to);
      const aWeight = calculateWeight(cs, c, config);
      c.weight = aWeight;
    }

    const aBias = adjustedBias(this, config);

    this.bias = aBias;
  }

  /**
   * Back-propagate the known activation, aka learn
   */
  propagate(
    requestedActivation: number,
    config: BackPropagationConfig,
  ): number {
    const activation = this.adjustedActivation(config);

    const squashMethod = this.findSquash();
    const targetActivation = squashMethod.range.limit(requestedActivation);

    const excludeFromBackPropagation = config.excludeSquashSet.has(
      this.squash ?? "UNDEFINED",
    );

    const ns = this.creature.state.node(this.index);
    if (
      excludeFromBackPropagation ||
      Math.abs(targetActivation - activation) < config.plankConstant
    ) {
      noChangePropagate(this, activation, config);
      return targetActivation;
    }

    ns.noChange = false;

    let limitedActivation: number;

    const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
    if (propagateUpdateMethod.propagate !== undefined) {
      limitedActivation = propagateUpdateMethod.propagate(
        this,
        targetActivation,
        config,
      );
      propagateUpdateMethod.range.validate(limitedActivation);
    } else {
      const targetValue = toValue(this, targetActivation, ns.hintValue);

      const currentValue = toValue(this, activation, ns.hintValue);
      const error = targetValue - currentValue;

      const currentBias = adjustedBias(this, config);
      let improvedValue = currentBias;
      const toList = this.creature.inwardConnections(this.index);

      const listLength = toList.length;

      if (listLength) {
        const indices = Int32Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

        if (!config.disableRandomSamples) {
          CreatureUtil.shuffle(indices);
        }

        const errorPerLink = error / listLength;

        // Iterate over the shuffled indices
        for (let i = listLength; i--;) {
          const indx = indices[i];

          const c = toList[indx];

          if (c.from === c.to) continue;

          const fromNeuron = this.creature.neurons[c.from];

          const fromActivation = fromNeuron.adjustedActivation(config);

          const fromWeight = adjustedWeight(this.creature.state, c, config);
          const fromValue = fromWeight * fromActivation;

          let improvedFromActivation = fromActivation;

          const targetFromValue = fromValue + errorPerLink;

          if (
            fromWeight &&
            fromNeuron.type !== "input" &&
            fromNeuron.type !== "constant"
          ) {
            const targetFromActivation = targetFromValue / fromWeight;

            improvedFromActivation = fromNeuron.propagate(
              targetFromActivation,
              config,
            );
          }

          if (
            Math.abs(improvedFromActivation) > config.plankConstant &&
            Math.abs(fromWeight) > config.plankConstant
          ) {
            const cs = this.creature.state.connection(c.from, c.to);
            accumulateWeight(
              c.weight,
              cs,
              targetFromValue,
              improvedFromActivation,
              config,
            );
            const aWeight = adjustedWeight(this.creature.state, c, config);

            const improvedFromValue = improvedFromActivation *
              aWeight;

            improvedValue += improvedFromValue;
          }
        }
      }

      accumulateBias(
        ns,
        targetValue,
        improvedValue,
        currentBias,
      );

      const aBias = adjustedBias(this, config);
      limitedActivation = (squashMethod as ActivationInterface).squash(
        improvedValue + aBias - currentBias,
      );
      propagateUpdateMethod.range.validate(limitedActivation);
    }

    if (Math.abs(limitedActivation - activation) > config.plankConstant) {
      ns.traceActivation(limitedActivation);
      this.creature.state.cacheAdjustedActivation.delete(this.index);
      return limitedActivation;
    } else {
      return activation;
    }
  }

  /**
   * Adjusts the activation based on the current state
   */
  adjustedActivation(config: BackPropagationConfig): number {
    const cache = this.creature.state.cacheAdjustedActivation;
    const cachedValue = cache.get(this.index);

    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const value = this.rawAdjustedActivation(config);

    cache.set(this.index, value);
    return value;
  }

  rawAdjustedActivation(config: BackPropagationConfig): number {
    if (this.type == "input") {
      return this.creature.state.activations[this.index];
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
            this.creature.state,
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
            this.squash = tmpSquash;
            delete this.squashMethodCache;
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

    const node = new Neuron(
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
        node.squash = json.squash;
        break;
      default:
        throw new Error("unknown type: " + (json as NeuronInternal).type);
    }

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
