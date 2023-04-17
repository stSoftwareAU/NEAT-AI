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

export class Node implements TagsInterface, NodeInternal {
  readonly network: Network;
  readonly type;
  readonly uuid: string;
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

        const ns = this.network.networkState.node(this.index);
        ns.derivative = result.derivative;

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

  private limit(delta: number, limit: number) {
    const limitedDelta = Math.min(
      Math.max(delta, Math.abs(limit) * -1),
      Math.abs(limit),
    );

    return limitedDelta;
  }

  propagateUpdate() {
    const ns = this.network.networkState.node(this.index);
    const toList = this.network.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const cs = this.network.networkState.connection(c.from, c.to);

      c.weight += this.limit(cs.totalDeltaWeight, 0.1);
      if (!Number.isFinite(c.weight)) {
        if (c.weight === Number.POSITIVE_INFINITY) {
          c.weight = Number.MAX_SAFE_INTEGER;
        } else if (c.weight === Number.NEGATIVE_INFINITY) {
          c.weight = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(c.weight)) {
          c.weight = 0;
        } else {
          console.trace();
          throw c.from + ":" + c.to + ") invalid weight: " + c.weight;
        }
      }

      cs.previousDeltaWeight = this.limit(cs.totalDeltaWeight, 0.1);
      cs.totalDeltaWeight = 0;
    }

    const deltaBias = ns.totalDeltaBias / ns.batchSize;

    this.bias += deltaBias;
    if (!Number.isFinite(this.bias)) {
      if (this.bias === Number.POSITIVE_INFINITY) {
        this.bias = Number.MAX_SAFE_INTEGER;
      } else if (this.bias === Number.NEGATIVE_INFINITY) {
        this.bias = Number.MIN_SAFE_INTEGER;
      } else if (isNaN(this.bias)) {
        this.bias = 0;
      } else {
        console.trace();
        throw this.index + ") invalid this.bias: " + this.bias;
      }
    }

    ns.totalDeltaBias = 0;
    ns.batchSize = 0;
  }
  /**
   * Back-propagate the error, aka learn
   */
  propagate(rate: number, target?: number) {
    // Error accumulator
    let error = 0;

    const ns = this.network.networkState.node(this.index);

    // Output nodes get their error from the environment
    if (this.type === "output") {
      const activation = this.network.getActivation(this.index);
      ns.errorResponsibility = ns.errorProjected = (target ? target : 0) -
        activation;
    } else { // the rest of the nodes compute their error responsibilities by back propagation
      // error responsibilities from all the connections projected from this node
      const fromList = this.network.fromConnections(this.index);

      for (let i = fromList.length; i--;) {
        const c = fromList[i];

        const toState = this.network.networkState.node(c.to);

        const tmpError = error +
          toState.errorResponsibility * c.weight;
        error = Number.isFinite(tmpError) ? tmpError : error;
      }

      // Projected error responsibility
      ns.errorProjected = ns.derivative * error;
      if (!Number.isFinite(ns.errorProjected)) {
        if (ns.errorProjected === Number.POSITIVE_INFINITY) {
          ns.errorProjected = Number.MAX_SAFE_INTEGER;
        } else if (ns.errorProjected === Number.NEGATIVE_INFINITY) {
          ns.errorProjected = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(ns.errorProjected)) {
          ns.errorProjected = 0;
        } else {
          console.trace();

          throw this.index + ") invalid error.projected: " + ns.errorProjected;
        }
      }

      // Error responsibility
      ns.errorResponsibility = ns.errorProjected;
    }

    if (this.type !== "constant") {
      // Adjust all the node's incoming connections
      const toList = this.network.toConnections(this.index);
      for (let i = toList.length; i--;) {
        const c = toList[i];

        const cs = this.network.networkState.connection(c.from, c.to);

        const gradient = ns.errorProjected * cs.eligibility;

        // Adjust weight
        const deltaWeight = rate * gradient;

        cs.totalDeltaWeight += deltaWeight;
      }

      // Adjust bias
      const deltaBias = rate * ns.errorResponsibility;
      ns.totalDeltaBias += deltaBias;
    }

    ns.batchSize++;
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
