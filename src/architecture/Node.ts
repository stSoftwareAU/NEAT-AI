/* Import */
import { Activations } from "../methods/activations/Activations.ts";
import { NodeActivationInterface } from "../methods/activations/NodeActivationInterface.ts";
import { NodeFixableInterface } from "../methods/activations/NodeFixableInterface.ts";
import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./Connection.ts";
import { addTags, removeTag, TagsInterface } from "../tags/TagsInterface.ts";
import { NodeExport, NodeInternal } from "./NodeInterfaces.ts";
import { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import { Network } from "./Network.ts";
import { ConnectionInternal } from "./ConnectionInterfaces.ts";
import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import { PLANK_CONSTANT } from "../config/NeatConfig.ts";
import {
  BackPropagationConfig,
  BackPropagationOptions,
  limitActivation,
  limitBias,
  limitValue,
  limitWeight,
} from "./BackPropagation.ts";

export class Node implements TagsInterface, NodeInternal {
  readonly network: Network;
  readonly type;
  uuid: string;
  bias: number;
  squash?: string;
  private squashMethodCache?: NodeActivationInterface | ActivationInterface;
  public index: number;
  public tags = undefined;

  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    network: Network,
    squash?: string,
  ) {
    this.uuid = uuid;
    if (!type) {
      console.trace();
      throw "type must be defined: " + (typeof type);
    }

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        console.trace();
        throw "invalid type: " + type;
      }

      if (bias === undefined) {
        this.bias = Math.random() * 0.2 - 0.1;
      } else {
        if (!Number.isFinite(bias)) {
          console.trace();
          throw "bias (other than for 'input') must be a number type: " + type +
            ", typeof: " +
            (typeof bias) + ", value: " + bias;
        }
        this.bias = bias;
      }

      if (type == "constant") {
        if (squash) {
          throw "constants should not a have a squash was: " + squash;
        }
      } else {
        this.squash = squash;
      }
    } else {
      this.bias = Infinity;
    }

    if (typeof network !== "object") {
      console.trace();
      throw "network must be a Network was: " + (typeof network);
    }

    this.network = network;

    this.type = type;

    this.index = -1;
  }

  setSquash(name: string) {
    if (this.type == "constant") {
      console.trace();
      throw "Can't set the squash of a constant";
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
      const toList = this.network.toConnections(this.index);
      toList.forEach((c) => {
        delete c.type;
      });
    }

    if (this.type == "hidden") {
      const fromList = this.network.fromConnections(this.index);
      if (fromList.length == 0) {
        const targetIndx = Math.min(
          1,
          Math.floor(
            Math.random() * (this.network.nodeCount() - this.index),
          ),
        ) +
          this.index;
        this.network.connect(
          this.index,
          targetIndx,
          Connection.randomWeight(),
        );
      }
      const toList = this.network.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.network.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.network.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() *
            (this.network.nodeCount() - this.network.outputCount()),
        );
        this.network.connect(
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
    activation: NodeActivationInterface | ActivationInterface,
  ): activation is NodeActivationInterface {
    return (activation as NodeActivationInterface).activate != undefined;
  }

  private hasApplyLearnings(
    activation:
      | ApplyLearningsInterface
      | NodeActivationInterface
      | ActivationInterface,
  ): activation is ApplyLearningsInterface {
    return (activation as ApplyLearningsInterface).applyLearnings != undefined;
  }

  private isFixableActivation(
    activation:
      | NodeActivationInterface
      | ActivationInterface
      | NodeFixableInterface,
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
        const toList = this.network.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];

          const fromActivation = this.network.getActivation(c.from);

          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        const result = activationSquash.squashAndDerive(value);
        // Squash the values received
        activation = result.activation;
        if (!Number.isFinite(activation)) {
          if (activation === Number.POSITIVE_INFINITY) {
            activation = Number.MAX_SAFE_INTEGER;
          } else if (activation === Number.NEGATIVE_INFINITY) {
            activation = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(activation)) {
            activation = 0;
          } else {
            console.trace();
            throw this.index + ") invalid value: + " + result +
              ", squash: " +
              this.squash +
              ", activation: " + activation;
          }
        }
      }
    }

    this.network.networkState.activations[this.index] = activation;
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

        const toList = this.network.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          const fromActivation = this.network.getActivation(c.from);

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
            console.trace();
            activation = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
    this.network.networkState.activations[this.index] = activation;

    // console.info(
    //   `${this.index}: noTraceActivate ${activation.toFixed(3)}, bias ${
    //     this.bias.toFixed(3)
    //   }`,
    // );
    return activation;
  }

  // private limit(delta: number, limit: number) {
  //   if (!Number.isFinite(delta)) {
  //     return 0;
  //   }

  //   const limitedDelta = Math.min(
  //     Math.max(delta, Math.abs(limit) * -1),
  //     Math.abs(limit),
  //   );

  //   return limitedDelta;
  // }

  private adjustedWeight(
    c: ConnectionInternal,
    options: BackPropagationOptions,
  ) {
    const cs = this.network.networkState.connection(c.from, c.to);

    if (cs.totalActivation) {
      const averageWeightPerActivation = cs.totalValue / cs.totalActivation; // BEST so far FAILS: Constants Few -18.6
      const averageWeightPerAbsoluteActivation = cs.totalValue /
        cs.absoluteActivation; // FAILS: Constants Few 4.5
      if (options.useAverageValuePerActivation) {
        if (Number.isFinite(averageWeightPerActivation)) {
          return limitWeight(averageWeightPerActivation);
        } else {
          console.info(
            `${this.index}: Invalid Weight : averageValuePerActivation ${averageWeightPerActivation}`,
          );
          return limitWeight(c.weight);
        }
      } else {
        return limitWeight(averageWeightPerAbsoluteActivation);
      }
    } else {
      return limitWeight(c.weight);
    }
  }

  private adjustedBias(config: BackPropagationConfig): number {
    if (this.type == "constant") {
      return this.bias ? this.bias : 0;
    } else {
      const ns = this.network.networkState.node(this.index);

      if (ns.count) {
        const averageDifferenceBias = (ns.totalValue - ns.totalWeightedSum) /
          ns.count;

        const unaccountedRatioBias = 1 - (ns.totalValue / ns.totalWeightedSum);

        if (
          config.useAverageDifferenceBias == "Yes" ||
          Number.isFinite(unaccountedRatioBias) == false
        ) {
          return limitBias(averageDifferenceBias);
        } else if (
          config.useAverageDifferenceBias == "No" ||
          (
            Math.abs(averageDifferenceBias - this.bias) <
              Math.abs(unaccountedRatioBias - this.bias)
          )
        ) {
          return limitBias(unaccountedRatioBias);
        } else {
          return limitBias(averageDifferenceBias);
        }
      } else {
        return limitBias(this.bias);
      }
    }
  }

  propagateUpdate(config: BackPropagationConfig) {
    const toList = this.network.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const adjustedWeight = this.adjustedWeight(c, config);

      c.weight = adjustedWeight;
    }

    const adjustedBias = this.adjustedBias(config);

    this.bias = adjustedBias;
  }

  private toValue(activation: number) {
    if (this.type == "input" || this.type == "constant") {
      return activation;
    }
    const squash = this.findSquash();
    if (((squash as unknown) as UnSquashInterface).unSquash != undefined) {
      const unSquasher = (squash as unknown) as UnSquashInterface;
      const value = unSquasher.unSquash(activation);

      if (!Number.isFinite(value)) {
        console.trace();
        throw `${this.index}: ${this.squash}.unSquash(${activation}) invalid -> ${value}`;
      }
      return limitValue(value);
    } else {
      return activation;
    }
  }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(
    targetActivation: number,
    config: BackPropagationConfig,
  ) {
    if (Number.isFinite(targetActivation) == false) {
      console.trace();
      throw `${this.index} Invalid targetActivation ${targetActivation} for ${this.type} ${this.squash} ${this.bias}`;
    }
    const activation = this.adjustedActivation(config);

    /** Short circuit  */
    if (Math.abs(activation - targetActivation) < 1e-12) {
      return activation;
    }

    const ns = this.network.networkState.node(this.index);

    const targetValue = this.toValue(targetActivation);

    const activationValue = this.toValue(activation);
    const error = targetValue - activationValue;

    let targetWeightedSum = 0;
    const toList = this.network.toConnections(this.index);

    const listLength = toList.length;
    const indices = Array.from({ length: listLength }, (_, i) => i); // Create an array of indices

    if (listLength > 1 && !(config.disableRandomList)) {
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
        let thisPerLinkError = errorPerLink;

        const c = toList[indx];

        if (c.from === c.to) continue;

        const fromNode = this.network.nodes[c.from];
        const fromActivation = fromNode.adjustedActivation(config);

        const cs = this.network.networkState.connection(c.from, c.to);

        const fromWeight = this.adjustedWeight(c, config);
        const fromValue = fromWeight * fromActivation;

        let improvedFromActivation = fromActivation;
        let targetFromActivation = fromActivation;
        const targetFromValue = fromValue + errorPerLink;
        let improvedFromValue = fromValue;
        if (
          fromWeight &&
          fromNode.type !== "input" &&
          fromNode.type !== "constant"
        ) {
          targetFromActivation = targetFromValue / fromWeight;
          if (Number.isFinite(targetFromActivation) == false) {
            throw `${this.index} targetFromActivation ${targetFromActivation} fromWeight ${fromWeight} targetFromValue ${targetFromValue}`;
          }
          improvedFromActivation = (fromNode as Node).propagate(
            targetFromActivation,
            config,
          );
          improvedFromValue = improvedFromActivation * fromWeight;

          thisPerLinkError = targetFromValue - improvedFromValue;
        }

        if (
          Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
          Math.abs(fromWeight) > PLANK_CONSTANT
        ) {
          const targetFromValue2 = fromValue + thisPerLinkError;

          cs.totalValue += targetFromValue2;
          cs.totalActivation += targetFromActivation;
          cs.absoluteActivation += Math.abs(improvedFromActivation);

          const adjustedWeight = this.adjustedWeight(c, config);

          const improvedAdjustedFromValue = improvedFromActivation *
            adjustedWeight;

          targetWeightedSum += improvedAdjustedFromValue;
        }
      }
    }

    ns.count++;
    ns.totalValue += targetValue;
    ns.totalWeightedSum += targetWeightedSum;

    const adjustedBias = this.adjustedBias(config);

    const adjustedActivation = targetWeightedSum + adjustedBias;

    const squashMethod = this.findSquash();

    if (this.isNodeActivation(squashMethod) == false) {
      const squashActivation = (squashMethod as ActivationInterface).squash(
        adjustedActivation,
      );

      return limitActivation(squashActivation);
    } else {
      return limitActivation(adjustedActivation);
    }
  }

  private adjustedActivation(config: BackPropagationConfig) {
    if (this.type == "input") {
      return this.network.networkState.activations[this.index];
    }

    if (this.type == "constant") {
      return this.bias;
    } else {
      const adjustedBias = this.adjustedBias(config);

      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        const adjustedActivation = squashMethod.noTraceActivate(this);

        if (!Number.isFinite(adjustedActivation)) {
          console.trace();
          throw `${this.index}: Squasher ${squashMethod.getName()} adjustedActivation: ${adjustedActivation}, bias: ${adjustedBias}, adjustedBias: ${adjustedBias}`;
        }
        const limitedActivation = limitActivation(adjustedActivation) +
          adjustedBias;

        if (!Number.isFinite(limitedActivation)) {
          console.trace();
          throw `${this.index}: Squasher ${squashMethod.getName()} limitedActivation: ${limitedActivation}, bias: ${adjustedBias}, adjustedBias: ${adjustedBias}`;
        }

        return limitedActivation;
      } else {
        // All activation sources coming from the node itself

        const toList = this.network.toConnections(this.index);
        let value = adjustedBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          if (c.from == c.to) continue;
          const fromActivation = (this.network.nodes[c.from] as Node)
            .adjustedActivation(config);

          const fromWeight = this.adjustedWeight(c, config);

          value += fromActivation * fromWeight;
          // if (!Number.isFinite(value)) {
          //   console.trace();
          //   throw `${c.from}:${c.to} adjustedBias: ${adjustedBias}, i:${i}, value: ${value}, fromActivation: ${fromActivation}, fromWeight: ${fromWeight}`;
          // }
          value = limitValue(value);
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        const squashed = activationSquash.squash(value);

        if (!Number.isFinite(squashed)) {
          console.trace();
          throw `${this.index}: Squasher ${activationSquash.getName()} value: ${value}, bias: ${adjustedBias}, squashedValue: ${squashed}`;
        }

        return limitActivation(squashed);
      }
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.network.disconnect(this.index, to);
    if (twoSided) {
      this.network.disconnect(to, this.index);
    }
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string) {
    if (typeof method !== "string") {
      console.trace();
      throw "Mutate method wrong type: " + (typeof method);
    }
    if (this.type == "input") {
      throw "Mutate on wrong node type: " + this.type;
    }
    switch (method) {
      case Mutation.MOD_ACTIVATION.name: {
        switch (this.type) {
          case "hidden":
          case "output":
            break;
          default:
            throw `Can't modify activation for type ${this.type}`;
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
        console.trace();
        throw "Unknown mutate method: " + method;
    }
    delete this.network.uuid;
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Node) {
    const c = this.network.getConnection(this.index, node.index);
    return c != null;
  }

  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy(node: Node) {
    const c = this.network.getConnection(node.index, this.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  exportJSON(): NodeExport {
    if (this.type === "input") {
      return {
        type: this.type,
        tags: this.tags ? [...this.tags] : undefined,
      };
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
    json: NodeExport,
    network: Network,
  ) {
    if (typeof network !== "object") {
      console.trace();
      throw "network must be a Network was: " + (typeof network);
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
        throw "unknown type: " + json.type;
    }

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
