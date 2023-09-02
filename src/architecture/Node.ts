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

        // Update traces

        const self = this.network.selfConnection(this.index);
        const selfState = this.network.networkState.connection(
          this.index,
          this.index,
        );

        for (let i = 0; i < toList.length; i++) {
          const c = toList[i];
          const fromActivation = this.network.getActivation(c.from);
          const cs = this.network.networkState.connection(c.from, c.to);
          if (self) {
            cs.eligibility = self.weight * selfState.eligibility +
              fromActivation;

            if (!Number.isFinite(cs.eligibility)) {
              if (cs.eligibility === Number.POSITIVE_INFINITY) {
                cs.eligibility = Number.MAX_SAFE_INTEGER;
              } else if (cs.eligibility === Number.NEGATIVE_INFINITY) {
                cs.eligibility = Number.MIN_SAFE_INTEGER;
              } else if (isNaN(cs.eligibility)) {
                cs.eligibility = 0;
              } else {
                console.trace();
                console.info(self, c, fromActivation);
                throw c.from + ":" + c.to + ") invalid eligibility: " +
                  cs.eligibility;
              }
            }
          } else {
            cs.eligibility = fromActivation;
            if (!Number.isFinite(cs.eligibility)) {
              if (cs.eligibility === Number.POSITIVE_INFINITY) {
                cs.eligibility = Number.MAX_SAFE_INTEGER;
              } else if (cs.eligibility === Number.NEGATIVE_INFINITY) {
                cs.eligibility = Number.MIN_SAFE_INTEGER;
              } else if (isNaN(cs.eligibility)) {
                cs.eligibility = 0;
              } else {
                console.trace();
                console.info(c, fromActivation);
                cs.eligibility = 0;
                // throw c.from + ":" + c.to + ") invalid eligibility: " +
                //   cs.eligibility;
              }
            }
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
  ) {
    const cs = this.network.networkState.connection(c.from, c.to);

    // if( cs.count){
    //   const avgWeight=cs.totalValue/cs.totalActivation;
    //   // return avgWeight;
    //   return (avgWeight * cs.count+c.weight)/(cs.count+1);
    // }
    // if( cs.count){
    //   const totalWeight=cs.totalValue-cs.totalActivation;
    //   return (totalWeight+c.weight)/(cs.count+1);
    // }
    if (cs.totalActivation) {
      const adjWeight = cs.totalValue / cs.totalActivation;
      const totalWeight = adjWeight * cs.count + c.weight;
      const avgWeight = totalWeight / (cs.count + 1);
      // console.info(
      //   `ZZZ ${c.from}:${c.to}) WEIGHT ${adjWeight}=${cs.totalValue}/${
      //     Math.abs(cs.totalActivation)
      //   } ~ ${avgWeight}`,
      // );
      return avgWeight;
    } // const avgValue=cs.totalValue/cs.count;
    // const avgActivation=cs.totalActivation/cs.count;
    else {
      return c.weight;
    }
  }

  // private readonly TRAINING_LIMIT = 0.1;
  propagateUpdate() {
    // console.info(`${this.index}: propagateUpdate`);
    const toList = this.network.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      c.weight = this.adjustedWeight(c);
    }

    this.bias = this.adjustedBias();
  }

  readonly PLANK_CONSTANT = 0.000_000_1;

  private toValue(activation: number) {
    if (this.type == "input" || this.type == "constant") {
      return activation;
    }
    const squash = this.findSquash();
    if (((squash as unknown) as UnSquashInterface).unSquash != undefined) {
      const unSquasher = (squash as unknown) as UnSquashInterface;
      const value = unSquasher.unSquash(activation);

      return value;
    } else {
      return activation;
    }
  }

  private readonly MAX_ADJUST = 2;

  private limit(delta: number, limit: number) {
    if (!Number.isFinite(delta)) {
      return 0;
    }

    const limitedDelta = Math.min(
      Math.max(delta, Math.abs(limit) * -1),
      Math.abs(limit),
    );

    return limitedDelta;
  }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(target: number) {
    // if (this.index == 4) {
    //   console.info("here");
    // }
    const activation = this.adjustedActivation();

    const targetValue = this.toValue(target);
    const activationValue = this.toValue(activation);
    const error = targetValue - activationValue;

    let correctedError = 0;
    let targetWeightedSum = 0;
    const toList = this.network.toConnections(this.index);

    const randomList = toList.slice().filter((c) => {
      /** Skip over self */
      return c.from != c.to;
    }).sort(() => Math.random() - 0.5);

    if (randomList.length) {
      const errorPerLink = error / toList.length;

      randomList.forEach((c) => {
        const fromNode = this.network.nodes[c.from];
        const fromActivation = fromNode.adjustedActivation();

        const cs = this.network.networkState.connection(c.from, c.to);

        const fromWeight = this.adjustedWeight(c);
        const fromValue = fromWeight * fromActivation;
        let weightResponsibility =
          Math.abs(fromActivation) > this.PLANK_CONSTANT
            ? Math.min(Math.max(Math.random(), 0.2), 0.8)
            : 0;

        if (
          fromNode.type == "input" ||
          fromNode.type == "constant"
        ) {
          weightResponsibility = 1;
        } else if (Math.abs(fromWeight) > this.PLANK_CONSTANT) {
          if (Math.abs(fromWeight) > this.MAX_ADJUST) {
            if (Math.abs(fromActivation) < this.MAX_ADJUST) {
              weightResponsibility = 0;
            }
          }
          const activationResponsibility = 1 - weightResponsibility;
          const activationError = errorPerLink * activationResponsibility;
          const targetActivationValue = fromValue + activationError;
          const targetActivationDelta = this.limit(
            targetActivationValue / fromWeight - fromActivation,
            1,
          );

          const targetActivation = fromActivation + targetActivationDelta;
          const improvedActivation = (fromNode as Node).propagate(
            targetActivation,
          );
          const improvedValue = improvedActivation * fromWeight;
          targetWeightedSum += improvedValue;
          correctedError += improvedValue - fromValue;
        } //else {
        //   console.info("ZERO weight");
        // }

        cs.count++;

        if (Math.abs(fromValue) > this.PLANK_CONSTANT) {
          const weightError = errorPerLink * weightResponsibility;
          const fromTargetValue = fromValue + weightError;

          cs.totalValue += fromTargetValue;
          cs.totalActivation += fromActivation; //ZZZ Math.abs(fromActivation);

          const currentWeight = this.adjustedWeight(c);

          const improvedValue = fromActivation * currentWeight;
          targetWeightedSum += improvedValue;
          correctedError += improvedValue - fromValue;
        } else {
          cs.totalActivation += fromActivation; //ZZZ Math.abs(fromActivation);
        }
      });
    }

    const ns = this.network.networkState.node(this.index);

    ns.count++;
    ns.totalValue += targetValue; // targetWeightedSum+error - correctedError;
    // if (Math.abs(targetValue - (targetWeightedSum + correctedError)) > 0.001) {
    //   console.info(
    //     `${this.index}: ${targetValue} ${
    //       targetWeightedSum + correctedError
    //     }=${targetWeightedSum}+${correctedError}`,
    //   );
    // }
    ns.totalWeightedSum += targetWeightedSum;
    const currentBias = this.adjustedBias();

    const estimatedValue = targetWeightedSum + currentBias;

    const squashMethod = this
      .findSquash();
    if (this.isNodeActivation(squashMethod) == false) {
      return (squashMethod as ActivationInterface).squash(estimatedValue);
    } else {
      return estimatedValue;
    }
  }

  private adjustedBias(): number {
    if (this.type == "constant") {
      return this.bias ? this.bias : 0;
    } else {
      const ns = this.network.networkState.node(this.index);

      if (ns.count) {
        const totalBias = ns.totalValue - ns.totalWeightedSum;
        const avgBias = totalBias / ns.count;
        // if (Math.abs(avgBias) > 2) {
        //   console.info(`ZZZ ${this.index}: large bias ${avgBias}`);
        // }
        return avgBias;
      } else {
        return this.bias;
      }
    }
  }

  private adjustedActivation() {
    if (this.type == "input") {
      return this.network.networkState.activations[this.index];
    }

    if (this.type == "constant") {
      return this.bias;
    } else {
      const adjustedBias = this.adjustedBias();

      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        return squashMethod.noTraceActivate(this) + adjustedBias;
      } else {
        // All activation sources coming from the node itself

        const toList = this.network.toConnections(this.index);
        let value = adjustedBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          const fromActivation = (this.network.nodes[c.from] as Node)
            .adjustedActivation();

          const fromWeight = this.adjustedWeight(c);

          value += fromActivation * fromWeight;
          // if( Math.abs( value) > 10){
          //   console.info( `${this.index} VALUE too big ${value}`);
          // }
        }

        // console.info( `${this.index}: value: ${value}, bias: ${adjustedBias}`);
        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        return activationSquash.squash(value);
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
        const modification =
          Math.random() * (Mutation.MOD_BIAS.max - Mutation.MOD_BIAS.min) +
          Mutation.MOD_BIAS.min;
        this.bias = modification + this.bias;
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
