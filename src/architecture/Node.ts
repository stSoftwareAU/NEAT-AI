/* Import */
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { NodeActivationInterface } from "../methods/activations/NodeActivationInterface.ts";
import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./Connection.ts";
import { addTags, TagsInterface } from "../tags/TagsInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";
import { NetworkUtil } from "./NetworkUtil.ts";

export class Node implements TagsInterface, NodeInterface {
  readonly util: NetworkUtil;
  readonly type;
  bias?: number;
  squash?: string;
  private old;
  private state;
  private activation;
  private derivative = 0;
  private previousDeltaBias;
  private totalDeltaBias;
  public index: number;
  public tags = undefined;

  private error;

  constructor(
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    util: NetworkUtil,
    squash: string = LOGISTIC.NAME,
  ) {
    if (!type) {
      console.trace();
      throw "type must be defined: " + (typeof type);
    }

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        console.trace();
        throw "invalid type: " + type;
      }

      if (typeof bias === "undefined") {
        bias = Math.random() * 0.2 - 0.1;
      }
      if (!Number.isFinite(bias)) {
        console.trace();
        throw "bias (other than for 'input') must be a number type: " + type +
          ", typeof: " +
          (typeof bias) + ", value: " + bias;
      }

      this.bias = bias;

      if (typeof squash !== "string") {
        console.trace();
        throw "squash (other than for " + type + ") must be a string typeof: " +
          (typeof squash) + ", value: " + squash;
      }
      this.squash = squash;
    }

    if (typeof util !== "object") {
      console.trace();
      throw "util must be a NetworkUtil was: " + (typeof util);
    }

    this.util = util;

    this.type = type;

    this.activation = 0;
    this.state = 0;
    this.old = 0;

    // For tracking momentum
    this.previousDeltaBias = 0;

    // Batch training
    this.totalDeltaBias = 0;

    this.index = -1;

    // Data for backpropagation
    this.error = {
      responsibility: 0,
      projected: 0,
      gated: 0,
    };
  }

  fix() {
    if (this.type == "hidden") {
      const fromList = this.util.fromConnections(this.index);
      if (fromList.length == 0) {
        const gateList = this.util.gateConnections(this.index);
        {
          if (gateList.length == 0) {
            const targetIndx =
              Math.floor(Math.random() * (this.util.nodeCount() - this.index)) +
              this.index;
            this.util.connect(
              this.index,
              targetIndx,
              Connection.randomWeight(),
            );
          }
        }
      }
      const toList = this.util.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.util.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.util.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() * (this.util.nodeCount() - this.util.outputCount()),
        );
        this.util.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    }
  }

  private isNodeActivation(
    activation: NodeActivationInterface | ActivationInterface,
  ): activation is NodeActivationInterface {
    return (activation as NodeActivationInterface).activate != undefined;
  }

  getActivation() {
    return this.activation;
  }

  /**
   * Activates the node
   */
  activate(input?: number) {
    if (this.type == "input") {
      if (Number.isFinite(input)) {
        this.activation = input ? input : 0;
        return this.activation;
      } else {
        console.trace();
        throw this.index +
          ") Node of type 'input' must have a finite value was: " + input;
      }
    } else {
      if (typeof input !== "undefined") {
        throw this.index + ") Node of type '" + this.type +
          "' Must not have an input value was: " + input;
      }
      if (!this.squash) {
        throw "Must have a squash for type: " + this.type;
      }
    }

    const activation = Activations.find(this.squash);

    if (this.isNodeActivation(activation)) {
      return activation.activate(this) + (this.bias ? this.bias : 0);
    } else {
      this.old = this.state;

      const toList = this.util.toConnections(this.index);
      this.state = this.bias ? this.bias : 0;
      toList.forEach((c) => {
        const fromNode = this.util.getNode(c.from);
        this.state += fromNode.activation * c.weight * (c as Connection).gain;
        if (Math.abs(this.state) > Number.MAX_SAFE_INTEGER) {
          this.state = Number.MAX_SAFE_INTEGER * (this.state < 0 ? -1 : 1);
        }
        if (!Number.isFinite(this.state)) {
          console.trace();
          console.info(fromNode, c);
          throw c.from + ") invalid state: " + this.state;
        }
      });

      const activationSquash = (activation as ActivationInterface);
      const result = activationSquash.squashAndDerive(this.state);
      // Squash the values received
      this.activation = result.activation;

      if (!Number.isFinite(this.activation)) {
        console.trace();

        throw this.index + ") invalid value: + " + this.state +
          ", activation: " + this.activation;
      }

      this.derivative = result.derivative;

      // Update traces
      const nodes: Node[] = [];
      const influences: number[] = [];

      const gateList = this.util.gateConnections(this.index);
      gateList.forEach((conn) => {
        const node = this.util.getNode(conn.to);

        const pos = nodes.indexOf(node);
        if (pos > -1) {
          const from = this.util.getNode(conn.from);
          influences[pos] += conn.weight * from.activation;
        } else {
          nodes.push(node);
          const from = this.util.getNode(conn.from);
          influences.push(
            conn.weight * from.activation +
              (conn.gater === this.index ? node.old : 0),
          );
        }

        // Adjust the gain to this nodes' activation
        (conn as Connection).gain = this.activation;
      });
      const self = this.util.selfConnection(this.index);
      for (let i = 0; i < toList.length; i++) {
        const c = ((toList[i] as unknown) as Connection);
        // Elegibility trace
        if (c.from === c.to && c.from == this.index) continue;

        const from = this.util.getNode(c.from);
        if (self) {
          c.elegibility = (self as Connection).gain * self.weight *
              (self as Connection).elegibility +
            from.activation * c.gain;
          if (!Number.isFinite(c.elegibility)) {
            console.trace();
            console.info(self, c, from.activation);
            throw c.from + ":" + c.to + ") invalid elegibility: " +
              c.elegibility;
          }
        } else {
          c.elegibility = from.activation * c.gain;
          if (!Number.isFinite(c.elegibility)) {
            console.trace();
            console.info(c, from.activation);
            throw c.from + ":" + c.to + ") invalid elegibility: " +
              c.elegibility;
          }
        }

        // Extended trace
        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];
          const influence = influences[j];

          const index = c.xtrace.nodes.indexOf(node);

          if (index > -1) {
            // const self = this.util.selfConnection(node.index);
            const value = self
              ? (((self as Connection).gain ? (self as Connection).gain : 0) *
                self.weight *
                c.xtrace.values[index])
              : 0 +
                this.derivative * c.elegibility * influence;

            c.xtrace.values[index] = value;
          } else {
            // Does not exist there yet, might be through mutation
            c.xtrace.nodes.push(node);
            c.xtrace.values.push(
              this.derivative * c.elegibility * influence,
            );
          }
        }
      }

      return this.activation;
    }
  }

  /**
   * Activates the node without calculating elegibility traces and such
   */
  noTraceActivate(input?: number) {
    if (this.type == "input") {
      if (Number.isFinite(input)) {
        this.activation = input ? input : 0;
        return this.activation;
      } else {
        throw this.index +
          ") Node of type 'input' must have a finite value was: " + input;
      }
    } else {
      if (typeof input !== "undefined") {
        throw this.index + ") Node of type '" + this.type +
          "' Must not have an input value was: " + input;
      }
      if (!this.squash) {
        throw "Must have a squash for type: " + this.type;
      }
    }

    const activation = Activations.find(this.squash);

    if (this.isNodeActivation(activation)) {
      return activation.activate(this);
    } else {
      // All activation sources coming from the node itself

      const conttections = this.util.toConnections(this.index);
      let value = this.bias ? this.bias : 0;
      conttections.forEach((c) => {
        value += this.util.getNode(c.from).activation * c.weight *
          (c as Connection).gain;
      });

      const activationSquash = (activation as ActivationInterface);
      // Squash the values received
      this.activation = activationSquash.squash(value);

      if (!Number.isFinite(this.activation)) {
        console.trace();

        throw this.index + ") invalid value: + " + value + ", activation: " +
          this.activation;
      }

      return this.activation;
    }
  }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(rate: number, momentum: number, update: boolean, target?: number) {
    momentum = momentum || 0;
    rate = rate || 0.3;

    // Error accumulator
    let error = 0;

    // Output nodes get their error from the enviroment
    if (this.type === "output") {
      this.error.responsibility = this.error.projected = (target ? target : 0) -
        this.activation;
    } else { // the rest of the nodes compute their error responsibilities by backpropagation
      // error responsibilities from all the connections projected from this node
      const fromList = this.util.fromConnections(this.index);
      fromList.forEach((c) => {
        const node = this.util.getNode(c.to);
        // Eq. 21
        const tmpError = error + node.error.responsibility * c.weight *
            (c as Connection).gain;
        error = Number.isFinite(tmpError) ? tmpError : error;
      });

      // Projected error responsibility
      this.error.projected = this.derivative * error;

      if (!Number.isFinite(this.error.projected)) {
        console.trace();
        console.info(this.error, this.derivative, error);
        throw this.index + ") invalid error.projected: " + this.error.projected;
      }

      // Error responsibilities from all connections gated by this neuron
      error = 0;

      const gateList = this.util.gateConnections(this.index);
      gateList.forEach((c) => {
        const node = this.util.getNode(c.to);
        const self = this.util.selfConnection(this.index);
        let influence = self ? node.old : 0;

        const fromNode = this.util.getNode(c.from);
        influence += c.weight * fromNode.activation;
        error += node.error.responsibility * influence;
      });

      // Gated error responsibility
      this.error.gated = this.derivative * error;

      // Error responsibility
      this.error.responsibility = this.error.projected + this.error.gated;
    }

    if (this.type === "constant") {
      return;
    }

    // Adjust all the node's incoming connections
    const toList = this.util.toConnections(this.index);
    for (let i = 0; i < toList.length; i++) {
      const connection = ((toList[i] as unknown) as Connection);

      let gradient = this.error.projected * connection.elegibility;

      for (let j = 0; j < connection.xtrace.nodes.length; j++) {
        const node = connection.xtrace.nodes[j];
        const value = connection.xtrace.values[j];
        gradient += node.error.responsibility * value;
      }

      // Adjust weight
      const deltaWeight = rate * gradient;
      connection.totalDeltaWeight += deltaWeight;
      if (update) {
        connection.totalDeltaWeight += momentum *
          connection.previousDeltaWeight;
        connection.weight += connection.totalDeltaWeight;
        if (!Number.isFinite(connection.weight)) {
          console.trace();
          console.info(this.error, connection, rate, gradient, momentum);
          throw connection.from + ":" + connection.to + ") invalid weight: " +
            connection.weight;
        }
        connection.previousDeltaWeight = connection.totalDeltaWeight;
        connection.totalDeltaWeight = 0;
      }
    }

    // Adjust bias
    const deltaBias = rate * this.error.responsibility;
    this.totalDeltaBias += deltaBias;
    if (update) {
      this.totalDeltaBias += momentum * this.previousDeltaBias;
      if (typeof this.bias !== "undefined") {
        this.bias += this.totalDeltaBias;
        if (!Number.isFinite(this.bias)) {
          console.trace();
          console.info(this);
          throw this.index + ") invalid bias: " + this.bias;
        }
      }
      this.previousDeltaBias = this.totalDeltaBias;
      this.totalDeltaBias = 0;
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.util.disconnect(this.index, to);
    if (twoSided) {
      this.util.disconnect(to, this.index);
    }
  }

  /**
   * Clear the context of the node
   */
  clear() {
    const toList = this.util.toConnections(this.index);

    toList.forEach((c) => {
      const connection = ((c as unknown) as Connection);

      connection.elegibility = 0;
      connection.xtrace = {
        nodes: [],
        values: [],
      };
    });

    const gateList = this.util.gateConnections(this.index);
    gateList.forEach((c) => {
      const connection = ((c as unknown) as Connection);
      connection.gain = 0;
    });

    this.error.responsibility = this.error.projected = this.error.gated = 0;
    this.old = this.state = this.activation = 0;
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string) {
    if (typeof method !== "string") {
      console.trace();
      throw "Mutate method wrong type: " + (typeof method);
    }
    switch (method) {
      case Mutation.MOD_ACTIVATION.name: {
        // Can't be the same squash
        while (true) {
          const tmpSquash = Activations
            .NAMES[Math.floor(Math.random() * Activations.NAMES.length)];

          if (tmpSquash != this.squash) {
            this.squash = tmpSquash;
            break;
          }
        }
        break;
      }
      case Mutation.MOD_BIAS.name: {
        const modification =
          Math.random() * (Mutation.MOD_BIAS.max - Mutation.MOD_BIAS.min) +
          Mutation.MOD_BIAS.min;
        this.bias = modification + (this.bias ? this.bias : 0);
        break;
      }
      default:
        console.trace();
        throw "Unknown mutate method: " + method;
    }
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Node) {
    const c = this.util.getConnection(this.index, node.index);
    return c != null;
  }
  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy(node: Node) {
    const c = this.util.getConnection(node.index, this.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  toJSON() {
    if (this.type === "input") {
      return {
        type: this.type,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        bias: this.bias,
        index: this.index,
        type: this.type,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Convert a json object to a node
   */
  static fromJSON(
    json: NodeInterface, // { type: string; bias: number; squash: string; tags?: [] },
    util: NetworkUtil,
  ) {
    switch (json.type) {
      case "input":
      case "output":
      case "hidden":
        break;
      default:
        throw "unknown type: " + json.type;
    }

    if (typeof util !== "object") {
      console.trace();
      throw "util must be a NetworkUtil was: " + (typeof util);
    }

    const node = new Node(json.type, json.bias, util);

    node.squash = json.squash;

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
