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
  private bias?;
  private squash: string;
  private old;
  private state;
  private activation;
  private derivative = 0;
  private previousDeltaBias;
  private totalDeltaBias;
  // public connections: ConnectionsInterface;
  public index: number;
  public tags = undefined;

  private error;

  constructor(
    type: "input" | "output" | "hidden" | "constant",
    bias: (number | undefined),
    util: NetworkUtil,
  ) {
    if (!type) {
      console.trace();
      throw "type must be defined: " + (typeof type);
    }

    if (type !== "input") {
      if (type !== "output" && type !== "hidden") {
        console.trace();
        throw "invalid type: " + type;
      }

      if (typeof bias !== "number") {
        console.trace();
        throw "bias (other than for " + type + ") must be a number was: " +
          (typeof bias);
      }

      this.bias = bias;
    }

    if (typeof util !== "object") {
      console.trace();
      throw "util must be a NetworkUtil was: " + (typeof util);
    }

    this.util = util;
    // this.bias = (type === "input") ? 0 : Math.random() * 0.2 - 0.1;
    this.squash = LOGISTIC.NAME;
    this.type = type;

    this.activation = 0;
    this.state = 0;
    this.old = 0;

    // For tracking momentum
    this.previousDeltaBias = 0;

    // Batch training
    this.totalDeltaBias = 0;

    this.index = -1;
    // this.connections = {
    //   in: [],
    //   out: [],
    //   gated: [],
    //   // self: []// new Connection(this, this, 0),
    // };

    // Data for backpropagation
    this.error = {
      responsibility: 0,
      projected: 0,
      gated: 0,
    };
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
    // Check if an input is given
    if (typeof input !== "undefined") {
      this.activation = input;
      return this.activation;
    }

    const activation = Activations.find(this.squash);

    if (this.isNodeActivation(activation)) {
      return activation.activate(this) + (this.bias ? this.bias : 0);
    } else {
      this.old = this.state;

      const toList = this.util.toConnections(this.index);
      this.state = 0;
      toList.forEach((c) => {
        this.state += this.util.getNode(c.from).activation * c.weight; // *
        // connection.gain;
      });

      // // All activation sources coming from the node itself
      // this.state =
      //   this.connections.self.gain * this.connections.self.weight * this.state +
      //   this.bias;

      // // Activation sources coming from connections
      // for (let i = 0; i < this.connections.in.length; i++) {
      //   const connection = this.connections.in[i];
      //   this.state += connection.from.activation * connection.weight *
      //     connection.gain;
      // }

      const activationSquash = (activation as ActivationInterface);
      const result = activationSquash.squashAndDerive(this.state);
      // Squash the values received
      this.activation = result.activation;
      this.derivative = result.derivative;
      // this.activation = this.squash(this.state);
      // this.derivative = this.squash(this.state, true);

      // Update traces
      const nodes: Node[] = [];
      const influences: number[] = [];

      const gateList = this.util.gateConnections(this.index);
      gateList.forEach((conn) => {
        // for (let i = 0; i < this.connections.gated.length; i++) {
        //   const conn = this.connections.gated[i];
        const node = this.util.getNode(conn.to);

        const index = nodes.indexOf(node);
        if (index > -1) {
          const from = this.util.getNode(conn.from);
          influences[index] += conn.weight * from.activation;
        } else {
          nodes.push(node);
          const from = this.util.getNode(conn.from);
          influences.push(
            conn.weight * from.activation +
              (conn.gater === this.index ? node.old : 0),
          );
        }

        // Adjust the gain to this nodes' activation
        conn.gain = this.activation;
      });

      toList.forEach((c) => {
        // for (let i = 0; i < this.connections.in.length; i++) {
        //   const connection = this.connections.in[i];
        const connection = ((c as unknown) as Connection);
        // Elegibility trace

        const from = this.util.getNode(c.from);
        const self = this.util.selfConnection(this.index);
        if (self) {
          connection.elegibility = (self.gain ? self.gain : 0) * self.weight *
              connection.elegibility +
            from.activation * connection.gain;
        } else {
          connection.elegibility = from.activation * connection.gain;
        }
        // Extended trace
        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];
          const influence = influences[j];

          const index = connection.xtrace.nodes.indexOf(node);

          if (index > -1) {
            const self = this.util.selfConnection(node.index);
            const value = self
              ? ((self.gain ? self.gain : 0) * self.weight *
                connection.xtrace.values[index])
              : 0 +
                this.derivative * connection.elegibility * influence;

            connection.xtrace.values[index] = value;
          } else {
            // Does not exist there yet, might be through mutation
            connection.xtrace.nodes.push(node);
            connection.xtrace.values.push(
              this.derivative * connection.elegibility * influence,
            );
          }
        }
      });

      return this.activation;
    }
  }
  /**
   * Activates the node without calculating elegibility traces and such
   */
  noTraceActivate(input?: number) {
    // Check if an input is given
    if (typeof input !== "undefined") {
      this.activation = input;
      return this.activation;
    }
    const activation = Activations.find(this.squash);

    if (this.isNodeActivation(activation)) {
      return activation.activate(this);
    } else {
      // All activation sources coming from the node itself
      // this.state =
      //   this.connections.self.gain * this.connections.self.weight * this.state +
      //   this.bias;

      const conttections = this.util.toConnections(this.index);
      let value = 0;
      conttections.forEach((c) => {
        value += this.util.getNode(c.from).activation * c.weight; // *
        // connection.gain;
      });
      // Activation sources coming from connections
      // for (let i = this.connections.in.length; i--;) {
      //   const connection = this.connections.in[i];
      //   this.state += connection.from.activation * connection.weight *
      //     connection.gain;
      // }
      const activationSquash = (activation as ActivationInterface);
      // Squash the values received
      this.activation = activationSquash.squash(value);

      // for (let i = this.connections.gated.length; i--;) {
      //   this.connections.gated[i].gain = this.activation;
      // }

      return this.activation;
    }
  }
  /**
   * Back-propagate the error, aka learn
   */
  propagate(rate: number, momentum: number, update: boolean, target: number) {
    momentum = momentum || 0;
    rate = rate || 0.3;

    // Error accumulator
    let error = 0;

    // Output nodes get their error from the enviroment
    if (this.type === "output") {
      this.error.responsibility = this.error.projected = target -
        this.activation;
    } else { // the rest of the nodes compute their error responsibilities by backpropagation
      // error responsibilities from all the connections projected from this node
      const toList = this.util.toConnections(this.index);
      toList.forEach((c) => {
        const node = this.util.getNode(c.to);
        // Eq. 21
        error += node.error.responsibility * c.weight *
          c.gain;
      });

      const fromList = this.util.fromConnections(this.index);
      fromList.forEach((c) => {
        const node = this.util.getNode(c.to);
        // Eq. 21
        error += node.error.responsibility * c.weight *
          c.gain;
      });

      // Projected error responsibility
      this.error.projected = this.derivative * error;

      // Error responsibilities from all connections gated by this neuron
      error = 0;

      const gateList = this.util.gateConnections(this.index);
      gateList.forEach((c) => {
        // for (let i = 0; i < this.connections.gated.length; i++) {
        // const conn = this.connections.gated[i];
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
        connection.previousDeltaWeight = connection.totalDeltaWeight;
        connection.totalDeltaWeight = 0;
      }
    }

    // Adjust bias
    const deltaBias = rate * this.error.responsibility;
    this.totalDeltaBias += deltaBias;
    if (update) {
      this.totalDeltaBias += momentum * this.previousDeltaBias;
      this.bias += this.totalDeltaBias;
      this.previousDeltaBias = this.totalDeltaBias;
      this.totalDeltaBias = 0;
    }
  }
  // /**
  //  * Creates a connection from this node to the given node
  //  */
  // connect(
  //   target: NodeInterface,
  //   weight: number,
  //   type?: "positive" | "negative" | "condition",
  // ) {
  //   const connections = [];
  //   if (target.type != "group") {
  //     // if (typeof target.bias !== "undefined") { // must be a node!
  //     // if (target === this) {
  //     //   // Turn on the self connection by setting the weight
  //     //   if (this.connections.self.weight !== 0) {
  //     //     console.warn("This connection already exists!");
  //     //   } else {
  //     //     this.connections.self.weight = weight || 1;
  //     //   }
  //     //   connections.push(this.connections.self);
  //     // } else
  //     if (this.isProjectingTo(target)) {
  //       throw new Error("Already projecting a connection to this node!");
  //     } else {
  //       const connection = new Connection(
  //         this.index,
  //         target.index,
  //         weight,
  //         type,
  //       );
  //       // target.connections.in.push(connection);
  //       // this.connections.out.push(connection);

  //       connections.push(connection);
  //     }
  //   } else { // should be a group
  //     const group = (target as unknown) as { nodes: Node[] };
  //     for (let i = 0; i < group.nodes.length; i++) {
  //       const connection = new Connection(this, group.nodes[i], weight, type);
  //       group.nodes[i].connections.in.push(connection);
  //       this.connections.out.push(connection);
  //       target.connections.in.push(connection);

  //       connections.push(connection);
  //     }
  //   }
  //   return connections;
  // }
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
   * Make this node gate a connection
   */
  gate(connections: Connection[]) {
    if (!Array.isArray(connections)) {
      connections = [connections];
    }

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];

      this.connections.gated.push(connection);
      connection.gater = this;
    }
  }
  /**
   * Removes the gates from this node from the given connection(s)
   */
  ungate(connections: Connection[]) {
    for (let i = connections.length - 1; i >= 0; i--) {
      const connection = connections[i];

      const index = this.connections.gated.indexOf(connection);
      this.connections.gated.splice(index, 1);
      connection.gater = null;
      connection.gain = 1;
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
    if (typeof method === "undefined") {
      throw new Error("No mutate method given!");
    } /*else if (!(method.name in Mutation.ALL)) {
          throw new Error("This method does not exist!");
        }*/

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
        this.bias += modification;
        break;
      }
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

    // if (node === this && this.connections.self.weight !== 0) {
    //   return true;
    // }

    // for (let i = 0; i < this.connections.in.length; i++) {
    //   const conn = this.connections.in[i];
    //   if (conn.from === node) {
    //     return true;
    //   }
    // }

    // return false;
  }
  /**
   * Converts the node to a json object
   */
  toJSON() {
    if (this.type === "input") {
      return {
        type: this.type,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        bias: this.bias,
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
    json: { type: string; bias: number; squash: string; tags?: [] },
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
    // node.bias = json.bias;
    // node.type = json.type;
    node.squash = json.squash; //Methods.activation[json.squash];

    if (json.tags) {
      addTags(node, json as TagsInterface);
    }
    return node;
  }
}
