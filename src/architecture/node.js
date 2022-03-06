/* Import */
import { Methods } from "../methods/methods.js";
import { Mutation } from "../methods/mutation.ts";
import Connection from "./connection.js";
import { Config } from "../config.ts";

/*******************************************************************************
                                         NODE
*******************************************************************************/

export function Node(type) {
  this.bias = (type === "input") ? 0 : Math.random() * 0.2 - 0.1;
  this.squash = Methods.activation.LOGISTIC;
  this.type = type || "hidden";

  this.activation = 0;
  this.state = 0;
  this.old = 0;

  // For dropout
  this.mask = 1;

  // For tracking momentum
  this.previousDeltaBias = 0;

  // Batch training
  this.totalDeltaBias = 0;

  this.connections = {
    in: [],
    out: [],
    gated: [],
    self: new Connection(this, this, 0),
  };

  // Data for backpropagation
  this.error = {
    responsibility: 0,
    projected: 0,
    gated: 0,
  };
}

Node.prototype = {
  /**
   * Activates the node
   */
  activate: function (input) {
    // Check if an input is given
    if (typeof input !== "undefined") {
      this.activation = input;
      return this.activation;
    }

    this.old = this.state;

    // All activation sources coming from the node itself
    this.state =
      this.connections.self.gain * this.connections.self.weight * this.state +
      this.bias;

    // Activation sources coming from connections
    for (let i = 0; i < this.connections.in.length; i++) {
      const connection = this.connections.in[i];
      this.state += connection.from.activation * connection.weight *
        connection.gain;
    }

    // Squash the values received
    this.activation = this.squash(this.state) * this.mask;
    this.derivative = this.squash(this.state, true);

    // Update traces
    const nodes = [];
    const influences = [];

    for (let i = 0; i < this.connections.gated.length; i++) {
      const conn = this.connections.gated[i];
      const node = conn.to;

      const index = nodes.indexOf(node);
      if (index > -1) {
        influences[index] += conn.weight * conn.from.activation;
      } else {
        nodes.push(node);
        influences.push(
          conn.weight * conn.from.activation +
            (node.connections.self.gater === this ? node.old : 0),
        );
      }

      // Adjust the gain to this nodes' activation
      conn.gain = this.activation;
    }

    for (let i = 0; i < this.connections.in.length; i++) {
      const connection = this.connections.in[i];

      // Elegibility trace
      connection.elegibility =
        this.connections.self.gain * this.connections.self.weight *
          connection.elegibility + connection.from.activation * connection.gain;

      // Extended trace
      for (let j = 0; j < nodes.length; j++) {
        const node = nodes[j];
        const influence = influences[j];

        const index = connection.xtrace.nodes.indexOf(node);

        if (index > -1) {
          connection.xtrace.values[index] =
            node.connections.self.gain * node.connections.self.weight *
              connection.xtrace.values[index] +
            this.derivative * connection.elegibility * influence;
        } else {
          // Does not exist there yet, might be through mutation
          connection.xtrace.nodes.push(node);
          connection.xtrace.values.push(
            this.derivative * connection.elegibility * influence,
          );
        }
      }
    }

    return this.activation;
  },

  /**
   * Activates the node without calculating elegibility traces and such
   */
  noTraceActivate: function (input) {
    // Check if an input is given
    if (typeof input !== "undefined") {
      this.activation = input;
      return this.activation;
    }

    // All activation sources coming from the node itself
    this.state =
      this.connections.self.gain * this.connections.self.weight * this.state +
      this.bias;

    // Activation sources coming from connections

    for (let i = this.connections.in.length; i--;) {
      const connection = this.connections.in[i];
      this.state += connection.from.activation * connection.weight *
        connection.gain;
    }

    // Squash the values received
    this.activation = this.squash(this.state);

    for (let i = this.connections.gated.length; i--;) {
      this.connections.gated[i].gain = this.activation;
    }

    return this.activation;
  },

  /**
   * Back-propagate the error, aka learn
   */
  propagate: function (rate, momentum, update, target) {
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

      for (let i = 0; i < this.connections.out.length; i++) {
        const connection = this.connections.out[i];
        const node = connection.to;
        // Eq. 21
        error += node.error.responsibility * connection.weight *
          connection.gain;
      }

      // Projected error responsibility
      this.error.projected = this.derivative * error;

      // Error responsibilities from all connections gated by this neuron
      error = 0;

      for (let i = 0; i < this.connections.gated.length; i++) {
        const conn = this.connections.gated[i];
        const node = conn.to;
        let influence = node.connections.self.gater === this ? node.old : 0;

        influence += conn.weight * conn.from.activation;
        error += node.error.responsibility * influence;
      }

      // Gated error responsibility
      this.error.gated = this.derivative * error;

      // Error responsibility
      this.error.responsibility = this.error.projected + this.error.gated;
    }

    if (this.type === "constant") return;

    // Adjust all the node's incoming connections
    for (let i = 0; i < this.connections.in.length; i++) {
      const connection = this.connections.in[i];

      let gradient = this.error.projected * connection.elegibility;

      for (let j = 0; j < connection.xtrace.nodes.length; j++) {
        const node = connection.xtrace.nodes[j];
        const value = connection.xtrace.values[j];
        gradient += node.error.responsibility * value;
      }

      // Adjust weight
      const deltaWeight = rate * gradient * this.mask;
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
  },

  /**
   * Creates a connection from this node to the given node
   */
  connect: function (target, weight) {
    const connections = [];
    if (typeof target.bias !== "undefined") { // must be a node!
      if (target === this) {
        // Turn on the self connection by setting the weight
        if (this.connections.self.weight !== 0) {
          if (Config.warnings) console.warn("This connection already exists!");
        } else {
          this.connections.self.weight = weight || 1;
        }
        connections.push(this.connections.self);
      } else if (this.isProjectingTo(target)) {
        throw new Error("Already projecting a connection to this node!");
      } else {
        const connection = new Connection(this, target, weight);
        target.connections.in.push(connection);
        this.connections.out.push(connection);

        connections.push(connection);
      }
    } else { // should be a group
      for (let i = 0; i < target.nodes.length; i++) {
        const connection = new Connection(this, target.nodes[i], weight);
        target.nodes[i].connections.in.push(connection);
        this.connections.out.push(connection);
        target.connections.in.push(connection);

        connections.push(connection);
      }
    }
    return connections;
  },

  /**
   * Disconnects this node from the other node
   */
  disconnect: function (node, twosided) {
    if (this === node) {
      this.connections.self.weight = 0;
      return;
    }

    for (let i = 0; i < this.connections.out.length; i++) {
      const conn = this.connections.out[i];
      if (conn.to === node) {
        this.connections.out.splice(i, 1);
        const j = conn.to.connections.in.indexOf(conn);
        conn.to.connections.in.splice(j, 1);
        if (conn.gater !== null) conn.gater.ungate(conn);
        break;
      }
    }

    if (twosided) {
      node.disconnect(this);
    }
  },

  /**
   * Make this node gate a connection
   */
  gate: function (connections) {
    if (!Array.isArray(connections)) {
      connections = [connections];
    }

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];

      this.connections.gated.push(connection);
      connection.gater = this;
    }
  },

  /**
   * Removes the gates from this node from the given connection(s)
   */
  ungate: function (connections) {
    if (!Array.isArray(connections)) {
      connections = [connections];
    }

    for (let i = connections.length - 1; i >= 0; i--) {
      const connection = connections[i];

      const index = this.connections.gated.indexOf(connection);
      this.connections.gated.splice(index, 1);
      connection.gater = null;
      connection.gain = 1;
    }
  },

  /**
   * Clear the context of the node
   */
  clear: function () {
    for (let i = 0; i < this.connections.in.length; i++) {
      const connection = this.connections.in[i];

      connection.elegibility = 0;
      connection.xtrace = {
        nodes: [],
        values: [],
      };
    }

    for (let i = 0; i < this.connections.gated.length; i++) {
      const conn = this.connections.gated[i];
      conn.gain = 0;
    }

    this.error.responsibility = this.error.projected = this.error.gated = 0;
    this.old = this.state = this.activation = 0;
  },

  /**
   * Mutates the node with the given method
   */
  mutate: function (method) {
    if (typeof method === "undefined") {
      throw new Error("No mutate method given!");
    } /*else if (!(method.name in Mutation.ALL)) {
      throw new Error("This method does not exist!");
    }*/

    switch (method) {
      case Mutation.MOD_ACTIVATION: {
        // Can't be the same squash
        const squash = method
          .allowed[
            (method.allowed.indexOf(this.squash) +
              Math.floor(Math.random() * (method.allowed.length - 1)) + 1) %
            method.allowed.length
          ];
        this.squash = squash;
        break;
      }
      case Mutation.MOD_BIAS: {
        const modification = Math.random() * (method.max - method.min) +
          method.min;
        this.bias += modification;
        break;
      }
    }
  },

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo: function (node) {
    if (node === this && this.connections.self.weight !== 0) return true;

    for (let i = 0; i < this.connections.out.length; i++) {
      const conn = this.connections.out[i];
      if (conn.to === node) {
        return true;
      }
    }
    return false;
  },

  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy: function (node) {
    if (node === this && this.connections.self.weight !== 0) return true;

    for (let i = 0; i < this.connections.in.length; i++) {
      const conn = this.connections.in[i];
      if (conn.from === node) {
        return true;
      }
    }

    return false;
  },

  /**
   * Converts the node to a json object
   */
  toJSON: function () {
    const json = {
      bias: this.bias,
      type: this.type,
      squash: this.squash.name,
      mask: this.mask,
    };

    return json;
  },
};

/**
 * Convert a json object to a node
 */
Node.fromJSON = function (json) {
  const node = new Node();
  node.bias = json.bias;
  node.type = json.type;
  node.mask = json.mask;
  node.squash = Methods.activation[json.squash];

  return node;
};
