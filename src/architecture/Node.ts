/* Import */
import { Creature } from "../Creature.ts";
import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import { NodeActivationInterface } from "../methods/activations/NodeActivationInterface.ts";
import { NodeFixableInterface } from "../methods/activations/NodeFixableInterface.ts";
import { Mutation } from "../methods/mutation.ts";
import { addTags, removeTag, TagsInterface } from "../tags/TagsInterface.ts";
import { Connection } from "./Connection.ts";
import { NodeExport, NodeInternal } from "./NodeInterfaces.ts";

import { PropagateInterface } from "../methods/activations/PropagateInterface.ts";
import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import {
  accumulateWeight,
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
  limitActivation,
  limitActivationToRange,
  limitValue,
  PLANK_CONSTANT,
  toValue,
} from "./BackPropagation.ts";

export class Node implements TagsInterface, NodeInternal {
  readonly creature: Creature;
  readonly type;
  uuid: string;
  bias: number;
  squash?: string;
  private squashMethodCache?:
    | NodeActivationInterface
    | ActivationInterface
    | PropagateInterface
    | UnSquashInterface;
  public index: number;
  public tags = undefined;

  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    network: Creature,
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

    if (typeof network !== "object") {
      throw new Error("network must be a Creature was: " + (typeof network));
    }

    this.creature = network;

    this.type = type;

    this.index = -1;
  }

  ID() {
    return this.uuid.substring(Math.max(0, this.uuid.length - 8));
  }

  setSquash(name: string) {
    if (this.type == "constant") {
      throw new Error("Can't set the squash of a constant");
    }
    delete this.squashMethodCache;
    this.squash = name;
    return this.findSquash();
  }

  findSquash() {
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
      const toList = this.creature.toConnections(this.index);
      toList.forEach((c) => {
        delete c.type;
      });
    }

    if (this.type == "hidden") {
      const fromList = this.creature.fromConnections(this.index);
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
          Connection.randomWeight(),
        );
      }
      const toList = this.creature.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.creature.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.creature.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() *
            (this.creature.nodeCount() - this.creature.outputCount()),
        );
        this.creature.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    }

    if (this.squash) {
      const activation = this.findSquash();

      if (this.isFixableActivation(activation)) {
        activation.fix(this);
      }
    }
  }

  private isNodeActivation(
    activation:
      | NodeActivationInterface
      | ActivationInterface
      | PropagateInterface
      | UnSquashInterface,
  ): activation is NodeActivationInterface {
    return (activation as NodeActivationInterface).activate != undefined;
  }

  private hasApplyLearnings(
    activation:
      | ApplyLearningsInterface
      | NodeActivationInterface
      | ActivationInterface
      | PropagateInterface
      | UnSquashInterface,
  ): activation is ApplyLearningsInterface {
    return (activation as ApplyLearningsInterface).applyLearnings != undefined;
  }

  private isFixableActivation(
    activation:
      | NodeActivationInterface
      | ActivationInterface
      | NodeFixableInterface
      | PropagateInterface
      | UnSquashInterface,
  ): activation is NodeFixableInterface {
    return (activation as NodeFixableInterface).fix != undefined;
  }

  /**
   * Activates the node
   */
  activate() {
    let activation: number;
    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();

      if (this.isNodeActivation(squashMethod)) {
        const squashActivation = squashMethod.activate(this);
        activation = squashActivation + this.bias;
      } else {
        const toList = this.creature.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];

          const fromActivation = this.creature.getActivation(c.from);

          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        activation = activationSquash.squash(value);
        // Squash the values received
        // activation = result.activation;
        if (!Number.isFinite(activation)) {
          if (activation === Number.POSITIVE_INFINITY) {
            activation = Number.MAX_SAFE_INTEGER;
          } else if (activation === Number.NEGATIVE_INFINITY) {
            activation = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(activation)) {
            activation = 0;
          } else {
            throw new Error(
              this.index + ") invalid value: + " + value +
                ", squash: " +
                this.squash +
                ", activation: " + activation,
            );
          }
        }
      }
    }

    this.creature.state.activations[this.index] = activation;
    return activation;
  }

  /**
   * Apply the learnings from the previous training.
   * @returns true if changed
   */
  applyLearnings() {
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
  noTraceActivate() {
    let activation: number;

    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        activation = squashMethod.noTraceActivate(this) + this.bias;
      } else {
        // All activation sources coming from the node itself

        const toList = this.creature.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          const fromActivation = this.creature.getActivation(c.from);

          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        activation = activationSquash.squash(value);

        if (!Number.isFinite(activation)) {
          if (activation === Number.POSITIVE_INFINITY) {
            activation = Number.MAX_SAFE_INTEGER;
          } else if (activation === Number.NEGATIVE_INFINITY) {
            activation = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(activation)) {
            activation = 0;
          } else {
            const msg = this.index + ") invalid value:" + value +
              ", squash: " +
              this.squash +
              ", activation: " +
              activation;
            console.warn(msg);

            activation = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
    this.creature.state.activations[this.index] = activation;

    return activation;
  }

  propagateUpdate(config: BackPropagationConfig) {
    const toList = this.creature.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const aWeight = adjustedWeight(this.creature.state, c, config);

      c.weight = aWeight;
    }

    const aBias = adjustedBias(this, config);

    this.bias = aBias;
  }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(
    requestedActivation: number,
    config: BackPropagationConfig,
  ) {
    const activation = this.adjustedActivation(config);

    const targetActivation = limitActivationToRange(this, requestedActivation);

    /** Short circuit  */
    if (Math.abs(activation - targetActivation) < 1e-12) {
      return activation;
    }

    const squashMethod = this.findSquash();

    if ((squashMethod as PropagateInterface).propagate !== undefined) {
      const improvedActivation = (squashMethod as PropagateInterface).propagate(
        this,
        targetActivation,
        config,
      );
      return limitActivation(improvedActivation);
    }

    const ns = this.creature.state.node(this.index);

    const targetValue = toValue(this, targetActivation);

    const currentValue = toValue(this, activation);
    const error = targetValue - currentValue;

    let improvedValue = adjustedBias(this, config);
    const toList = this.creature.toConnections(this.index);

    const listLength = toList.length;
    const indices = Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

    if (listLength > 1 && !config.disableRandomSamples) {
      // Fisher-Yates shuffle algorithm
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }

    if (listLength) {
      const errorPerLink = error / listLength;

      // Iterate over the shuffled indices
      for (let i = listLength; i--;) {
        const indx = indices[i];
        // let thisPerLinkError = errorPerLink;

        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNode = this.creature.nodes[c.from];

        const fromActivation = fromNode.adjustedActivation(config);

        const fromWeight = adjustedWeight(this.creature.state, c, config);
        const fromValue = fromWeight * fromActivation;

        let improvedFromActivation = fromActivation;
        // let targetFromActivation = fromActivation;
        const targetFromValue = fromValue + errorPerLink;
        // let improvedFromValue = fromValue;
        if (
          fromWeight &&
          fromNode.type !== "input" &&
          fromNode.type !== "constant"
        ) {
          const targetFromActivation = targetFromValue / fromWeight;

          improvedFromActivation = (fromNode as Node).propagate(
            targetFromActivation,
            config,
          );
          // improvedFromValue = improvedFromActivation * fromWeight;

          // thisPerLinkError = targetFromValue - improvedFromValue;
        }

        if (
          Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
          Math.abs(fromWeight) > PLANK_CONSTANT
        ) {
          // const targetFromValue2 = fromValue + thisPerLinkError;
          const cs = this.creature.state.connection(c.from, c.to);
          accumulateWeight(cs, targetFromValue, improvedFromActivation);

          // adjustWeight(cs, targetFromValue2, improvedFromActivation);
          const aWeight = adjustedWeight(this.creature.state, c, config);

          const improvedFromValue = improvedFromActivation *
            aWeight;

          improvedValue += improvedFromValue;
        }
      }
    }

    ns.count++;
    ns.totalValue += targetValue;
    ns.totalWeightedSum += improvedValue;

    const aBias = adjustedBias(this, config);

    if (this.isNodeActivation(squashMethod) == false) {
      const squashActivation = (squashMethod as ActivationInterface).squash(
        improvedValue + aBias,
      );

      return limitActivation(squashActivation);
    } else {
      const adjustedActivation = squashMethod.activate(this) + aBias;
      return limitActivation(adjustedActivation);
    }
  }

  adjustedActivation(config: BackPropagationConfig) {
    if (this.type == "input") {
      return this.creature.state.activations[this.index];
    }

    if (this.type == "constant") {
      return this.bias;
    } else {
      const aBias = adjustedBias(this, config);

      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        const adjustedActivation = squashMethod.noTraceActivate(this);

        const limitedActivation = limitActivation(adjustedActivation) +
          aBias;

        return limitedActivation;
      } else {
        // All activation sources coming from the node itself

        const toList = this.creature.toConnections(this.index);
        let value = aBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          if (c.from == c.to) continue;
          const fromActivation = (this.creature.nodes[c.from] as Node)
            .adjustedActivation(config);

          const fromWeight = adjustedWeight(
            this.creature.state,
            c,
            config,
          );

          value += fromActivation * fromWeight;

          value = limitValue(value);
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        const squashed = activationSquash.squash(value);

        if (!Number.isFinite(squashed)) {
          throw new Error(
            `${this.index}: Squasher ${activationSquash.getName()} value: ${value}, bias: ${adjustedBias}, squashedValue: ${squashed}`,
          );
        }

        return limitActivation(squashed);
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
  mutate(method: string) {
    if (typeof method !== "string") {
      throw new Error("Mutate method wrong type: " + (typeof method));
    }
    if (this.type == "input") {
      throw new Error("Mutate on wrong node type: " + this.type);
    }
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
        break;
      }
      default:
        throw new Error("Unknown mutate method: " + method);
    }
    delete this.creature.uuid;
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Node) {
    const c = this.creature.getConnection(this.index, node.index);
    return c != null;
  }

  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy(node: Node) {
    const c = this.creature.getConnection(node.index, this.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  exportJSON(): NodeExport {
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
  internalJSON(indx: number): NodeInternal {
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
    json: NodeExport | NodeInternal,
    network: Creature,
  ) {
    if (typeof network !== "object") {
      throw new Error("network must be a Creature was: " + (typeof network));
    }

    const node = new Node(
      json.uuid ? json.uuid : crypto.randomUUID(),
      json.type,
      json.bias,
      network,
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
        throw new Error("unknown type: " + (json as NodeInternal).type);
    }

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
