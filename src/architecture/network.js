import { WorkerHandle } from "../multithreading/workers/worker-handle.ts";
import { Methods } from "../methods/methods.js";
import { Mutation } from "../methods/mutation.ts";

import Connection from "./connection.js";
import { Config } from "../config.ts";
import Neat from "../neat.js";
import { Node } from "./node.js";
import { freezeAndValidate } from "./DataSet.ts";

/*******************************************************************************
                                 NETWORK
*******************************************************************************/

export function Network(input, output, initialise = true) {
  if (typeof input === "undefined" || typeof output === "undefined") {
    throw new Error("No input or output size given");
  }

  this.input = input;
  this.output = output;

  // Store all the node and connection genes
  const nLen=this.input + this.output;
  this.nodes = new Array(nLen); // Stored in activation order
  this.connections = [];
  this.gates = [];
  this.selfconns = [];

  // Regularization
  this.dropout = 0;

  if (initialise) {
    // Create input and output nodes

    for (let i = nLen; i--; ) {
      const type = i < this.input ? "input" : "output";
      this.nodes[i]=new Node(type);
    }

    // Connect input nodes with output nodes directly
    for (let i = 0; i < this.input; i++) {
      for (let j = this.input; j < this.output + this.input; j++) {
        // https://stats.stackexchange.com/a/248040/147931
        const weight = Math.random() * this.input * Math.sqrt(2 / this.input);
        this.connect(this.nodes[i], this.nodes[j], weight);
      }
    }
  }
}

Network.prototype = {
  /**
   * Activates the network
   */
  activate: function (input, training) {
    const output = [];

    // Activate nodes chronologically
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].type === "input") {
        this.nodes[i].activate(input[i]);
      } else if (this.nodes[i].type === "output") {
        const activation = this.nodes[i].activate();
        output.push(activation);
      } else {
        if (training) this.nodes[i].mask = Math.random() < this.dropout ? 0 : 1;
        this.nodes[i].activate();
      }
    }

    return output;
  },

  /**
   * Activates the network without calculating elegibility traces and such
   */
  noTraceActivate: function (input) {
    const output = new Array(this.nodes.length);
    let outputLen = 0;
    // Activate nodes chronologically
    for (let i = 0; i < this.nodes.length; i++) { // Order matters for some reason.
      const _node = this.nodes[i];
      switch (_node.type) {
        case "input": {
          _node.noTraceActivate(input[i]);
          break;
        }
        case "output": {
          const activation = _node.noTraceActivate();
          output[outputLen] = activation;
          outputLen++;
          break;
        }
        default:
          _node.noTraceActivate();
      }
    }
    output.length = outputLen;
    return output;
  },

  /**
   * Backpropagate the network
   */
  propagate: function (rate, momentum, update, target) {
    if (typeof target === "undefined" || target.length !== this.output) {
      throw new Error(
        "Output target length should match network output length",
      );
    }

    let targetIndex = target.length;

    // Propagate output nodes
    for (
      let i = this.nodes.length - 1;
      i >= this.nodes.length - this.output;
      i--
    ) {
      this.nodes[i].propagate(rate, momentum, update, target[--targetIndex]);
    }

    // Propagate hidden and input nodes
    for (let i = this.nodes.length - this.output - 1; i >= this.input; i--) {
      this.nodes[i].propagate(rate, momentum, update);
    }
  },

  /**
   * Clear the context of the network
   */
  clear: function () {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].clear();
    }
  },

  /**
   * Connects the from node to the to node
   */
  connect: function (from, to, weight) {
    const _connections = from.connect(to, weight);

    for (let i = 0; i < _connections.length; i++) {
      const connection = _connections[i];
      if (from !== to) {
        this.connections.push(connection);
      } else {
        this.selfconns.push(connection);
      }
    }

    return _connections;
  },

  /**
   * Disconnects the from node from the to node
   */
  disconnect: function (from, to) {
    // Delete the connection in the network's connection array
    const connections = from === to ? this.selfconns : this.connections;

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        if (connection.gater !== null) this.ungate(connection);
        connections.splice(i, 1);
        break;
      }
    }

    // Delete the connection at the sending and receiving neuron
    from.disconnect(to);
  },

  /**
   * Gate a connection with a node
   */
  gate: function (node, connection) {
    if (this.nodes.indexOf(node) === -1) {
      throw new Error("This node is not part of the network!");
    } else if (connection.gater != null) {
      if (Config.warnings) console.warn("This connection is already gated!");
      return;
    }
    node.gate(connection);
    this.gates.push(connection);
  },

  /**
   *  Remove the gate of a connection
   */
  ungate: function (connection) {
    const index = this.gates.indexOf(connection);
    if (index === -1) {
      throw new Error("This connection is not gated!");
    }

    this.gates.splice(index, 1);
    connection.gater.ungate(connection);
  },

  /**
   *  Removes a node from the network
   */
  remove: function (node) {
    const index = this.nodes.indexOf(node);

    if (index === -1) {
      throw new Error("This node does not exist in the network!");
    }

    // Keep track of gaters
    const gaters = [];

    // Remove selfconnections from this.selfconns
    this.disconnect(node, node);

    // Get all its inputting nodes
    const inputs = [];
    for (let i = node.connections.in.length - 1; i >= 0; i--) {
      const connection = node.connections.in[i];
      if (
        Mutation.SUB_NODE.keep_gates && connection.gater !== null &&
        connection.gater !== node
      ) {
        gaters.push(connection.gater);
      }
      inputs.push(connection.from);
      this.disconnect(connection.from, node);
    }

    // Get all its outputing nodes
    const outputs = [];
    for (let i = node.connections.out.length - 1; i >= 0; i--) {
      const connection = node.connections.out[i];
      if (
        Mutation.SUB_NODE.keep_gates && connection.gater !== null &&
        connection.gater !== node
      ) {
        gaters.push(connection.gater);
      }
      outputs.push(connection.to);
      this.disconnect(node, connection.to);
    }

    // Connect the input nodes to the output nodes (if not already connected)
    const connections = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      for (let j = 0; j < outputs.length; j++) {
        const output = outputs[j];
        if (!input.isProjectingTo(output)) {
          const conn = this.connect(input, output);
          connections.push(conn[0]);
        }
      }
    }

    // Gate random connections with gaters
    for (let i = 0; i < gaters.length; i++) {
      if (connections.length === 0) break;

      const gater = gaters[i];
      const connIndex = Math.floor(Math.random() * connections.length);

      this.gate(gater, connections[connIndex]);
      connections.splice(connIndex, 1);
    }

    // Remove gated connections gated by this node
    for (let i = node.connections.gated.length - 1; i >= 0; i--) {
      const conn = node.connections.gated[i];
      this.ungate(conn);
    }

    // Remove selfconnection
    this.disconnect(node, node);

    // Remove the node from this.nodes
    this.nodes.splice(index, 1);
  },

  /**
   * Mutates the network with the given method
   */
  mutate: function (method) {
    if (typeof method === "undefined") {
      throw new Error("No (correct) mutate method given!");
    }

    switch (method) {
      case Mutation.ADD_NODE: {
        // Look for an existing connection and place a node in between
        const connection =
          this.connections[Math.floor(Math.random() * this.connections.length)];
        const gater = connection.gater;
        this.disconnect(connection.from, connection.to);

        // Insert the new node right before the old connection.to
        const toIndex = this.nodes.indexOf(connection.to);
        const node = new Node("hidden");

        // Random squash function
        node.mutate(Mutation.MOD_ACTIVATION);

        // Place it in this.nodes
        const minBound = Math.min(toIndex, this.nodes.length - this.output);
        this.nodes.splice(minBound, 0, node);

        // Now create two new connections
        const newConn1 = this.connect(connection.from, node)[0];
        const newConn2 = this.connect(node, connection.to)[0];

        // Check if the original connection was gated
        if (gater != null) {
          this.gate(gater, Math.random() >= 0.5 ? newConn1 : newConn2);
        }
        break;
      }
      case Mutation.SUB_NODE: {
        // Check if there are nodes left to remove
        if (this.nodes.length === this.input + this.output) {
          if (Config.warnings) console.warn("No more nodes left to remove!");
          break;
        }

        // Select a node which isn't an input or output node
        const index = Math.floor(
          Math.random() * (this.nodes.length - this.output - this.input) +
            this.input,
        );
        this.remove(this.nodes[index]);
        break;
      }
      case Mutation.ADD_CONN: {
        // Create an array of all uncreated (feedforward) connections
        const available = [];
        for (let i = 0; i < this.nodes.length - this.output; i++) {
          const node1 = this.nodes[i];
          for (let j = Math.max(i + 1, this.input); j < this.nodes.length; j++) {
            const node2 = this.nodes[j];
            if (!node1.isProjectingTo(node2)) available.push([node1, node2]);
          }
        }

        if (available.length === 0) {
          if (Config.warnings) console.warn("No more connections to be made!");
          break;
        }

        const pair = available[Math.floor(Math.random() * available.length)];
        this.connect(pair[0], pair[1]);
        break;
      }
      case Mutation.SUB_CONN: {
        // List of possible connections that can be removed
        const possible = [];

        for (let i = 0; i < this.connections.length; i++) {
          const conn = this.connections[i];
          // Check if it is not disabling a node
          if (
            conn.from.connections.out.length > 1 &&
            conn.to.connections.in.length > 1 &&
            this.nodes.indexOf(conn.to) > this.nodes.indexOf(conn.from)
          ) {
            possible.push(conn);
          }
        }

        if (possible.length === 0) {
          if (Config.warnings) console.warn("No connections to remove!");
          break;
        }

        const randomConn =
          possible[Math.floor(Math.random() * possible.length)];
        this.disconnect(randomConn.from, randomConn.to);
        break;
      }
      case Mutation.MOD_WEIGHT: {
        const allconnections = this.connections.concat(this.selfconns);

        const connection =
          allconnections[Math.floor(Math.random() * allconnections.length)];
        const modification = Math.random() * (method.max - method.min) +
          method.min;
        connection.weight += modification;
        break;
      }
      case Mutation.MOD_BIAS: {
        // Has no effect on input node, so they are excluded
        const index = Math.floor(
          Math.random() * (this.nodes.length - this.input) + this.input,
        );
        const node = this.nodes[index];
        node.mutate(method);
        break;
      }
      case Mutation.MOD_ACTIVATION: {
        // Has no effect on input node, so they are excluded
        if (
          !method.mutateOutput && this.input + this.output === this.nodes.length
        ) {
          if (Config.warnings) {
            console.warn("No nodes that allow mutation of activation function");
          }
          break;
        }

        const index = Math.floor(
          Math.random() *
              (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
                this.input) + this.input,
        );
        const node = this.nodes[index];

        node.mutate(method);
        break;
      }
      case Mutation.ADD_SELF_CONN: {
        // Check which nodes aren't selfconnected yet
        const possible = [];
        for (let i = this.input; i < this.nodes.length; i++) {
          const node = this.nodes[i];
          if (node.connections.self.weight === 0) {
            possible.push(node);
          }
        }

        if (possible.length === 0) {
          if (Config.warnings) console.warn("No more self-connections to add!");
          break;
        }

        // Select a random node
        const node = possible[Math.floor(Math.random() * possible.length)];

        // Connect it to himself
        this.connect(node, node);
        break;
      }
      case Mutation.SUB_SELF_CONN: {
        if (this.selfconns.length === 0) {
          if (Config.warnings) {
            console.warn("No more self-connections to remove!");
          }
          break;
        }
        const conn =
          this.selfconns[Math.floor(Math.random() * this.selfconns.length)];
        this.disconnect(conn.from, conn.to);
        break;
      }
      case Mutation.ADD_GATE: {
        const allconnections = this.connections.concat(this.selfconns);

        // Create a list of all non-gated connections
        const possible = [];
        for (let i = 0; i < allconnections.length; i++) {
          const conn = allconnections[i];
          if (conn.gater === null) {
            possible.push(conn);
          }
        }

        if (possible.length === 0) {
          if (Config.warnings) console.warn("No more connections to gate!");
          break;
        }

        // Select a random gater node and connection, can't be gated by input
        const index = Math.floor(
          Math.random() * (this.nodes.length - this.input) + this.input,
        );
        const node = this.nodes[index];
        const conn = possible[Math.floor(Math.random() * possible.length)];

        // Gate the connection with the node
        this.gate(node, conn);
        break;
      }
      case Mutation.SUB_GATE: {
        // Select a random gated connection
        if (this.gates.length === 0) {
          if (Config.warnings) console.warn("No more connections to ungate!");
          break;
        }

        const index = Math.floor(Math.random() * this.gates.length);
        const gatedconn = this.gates[index];

        this.ungate(gatedconn);
        break;
      }
      case Mutation.ADD_BACK_CONN: {
        // Create an array of all uncreated (backfed) connections
        const available = [];
        for (let i = this.input; i < this.nodes.length; i++) {
          const node1 = this.nodes[i];
          for (let j = this.input; j < i; j++) {
            const node2 = this.nodes[j];
            if (!node1.isProjectingTo(node2)) available.push([node1, node2]);
          }
        }

        if (available.length === 0) {
          if (Config.warnings) console.warn("No more connections to be made!");
          break;
        }

        const pair = available[Math.floor(Math.random() * available.length)];
        this.connect(pair[0], pair[1]);
        break;
      }
      case Mutation.SUB_BACK_CONN: {
        // List of possible connections that can be removed
        const possible = [];

        for (let i = 0; i < this.connections.length; i++) {
          const conn = this.connections[i];
          // Check if it is not disabling a node
          if (
            conn.from.connections.out.length > 1 &&
            conn.to.connections.in.length > 1 &&
            this.nodes.indexOf(conn.from) > this.nodes.indexOf(conn.to)
          ) {
            possible.push(conn);
          }
        }

        if (possible.length === 0) {
          if (Config.warnings) console.warn("No connections to remove!");
          break;
        }

        const randomConn =
          possible[Math.floor(Math.random() * possible.length)];
        this.disconnect(randomConn.from, randomConn.to);
        break;
      }
      case Mutation.SWAP_NODES: {
        // Has no effect on input node, so they are excluded
        if (
          (method.mutateOutput && this.nodes.length - this.input < 2) ||
          (!method.mutateOutput &&
            this.nodes.length - this.input - this.output < 2)
        ) {
          if (Config.warnings) {
            console.warn(
              "No nodes that allow swapping of bias and activation function",
            );
          }
          break;
        }

        let index = Math.floor(
          Math.random() *
              (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
                this.input) + this.input,
        );
        const node1 = this.nodes[index];
        index = Math.floor(
          Math.random() *
              (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
                this.input) + this.input,
        );
        const node2 = this.nodes[index];

        const biasTemp = node1.bias;
        const squashTemp = node1.squash;

        node1.bias = node2.bias;
        node1.squash = node2.squash;
        node2.bias = biasTemp;
        node2.squash = squashTemp;
        break;
      }
    }
  },

  /**
   * Train the given set to this network
   */
  train: function (set, options) {
    if (
      set[0].input.length !== this.input || set[0].output.length !== this.output
    ) {
      throw new Error(
        "Dataset input/output size should be same as network input/output size!",
      );
    }

    options = options || {};

    // Warning messages
    if (typeof options.rate === "undefined") {
      if (Config.warnings) {
        console.warn("Using default learning rate, please define a rate!");
      }
    }
    if (typeof options.iterations === "undefined") {
      if (Config.warnings) {
        console.warn(
          "No target iterations given, running until error is reached!",
        );
      }
    }

    // Read the options
    let targetError = options.error || 0.05;
    const cost = options.cost || Methods.cost.MSE;
    const baseRate = options.rate || 0.3;
    const dropout = options.dropout || 0;
    const momentum = options.momentum || 0;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicy = options.ratePolicy || Methods.rate.FIXED();

    const start = Date.now();

    if (batchSize > set.length) {
      throw new Error("Batch size must be smaller or equal to dataset length!");
    } else if (
      typeof options.iterations === "undefined" &&
      typeof options.error === "undefined"
    ) {
      throw new Error(
        "At least one of the following options must be specified: error, iterations",
      );
    } else if (typeof options.error === "undefined") {
      targetError = -1; // run until iterations
    } else if (typeof options.iterations === "undefined") {
      options.iterations = 0; // run until target error
    }

    // Save to network
    this.dropout = dropout;

    /*if (options.crossValidate) {
      const numTrain = Math.ceil(
        (1 - options.crossValidate.testSize) * set.length,
      );
      const trainSet = set.slice(0, numTrain);
      const testSet = set.slice(numTrain);
    }*/

    // Loops the training process
    let currentRate = baseRate;
    let iteration = 0;
    let error = 1;

    let i, j, x;
    while (
      error > targetError &&
      (options.iterations === 0 || iteration < options.iterations)
    ) {
      if (options.crossValidate && error <= options.crossValidate.testError) {
        break;
      }

      iteration++;

      // Update the rate
      currentRate = ratePolicy(baseRate, iteration);

      // Checks if cross validation is enabled
      if (options.crossValidate) {
        this._trainSet(trainSet, batchSize, currentRate, momentum, cost);
        if (options.clear) this.clear();
        error = this.test(testSet, cost).error;
        if (options.clear) this.clear();
      } else {
        error = this._trainSet(set, batchSize, currentRate, momentum, cost);
        if (options.clear) this.clear();
      }

      // Checks for options such as scheduled logs and shuffling
      if (options.shuffle) {
        for (
          j, x, i = set.length;
          i;
          j = Math.floor(Math.random() * i),
            x = set[--i],
            set[i] = set[j],
            set[j] = x
        );
      }

      if (options.log && iteration % options.log === 0) {
        console.log(
          "iteration",
          iteration,
          "error",
          error,
          "rate",
          currentRate,
        );
      }

      if (options.schedule && iteration % options.schedule.iterations === 0) {
        options.schedule.function({ error: error, iteration: iteration });
      }
    }

    if (options.clear) this.clear();

    if (dropout) {
      for (i = 0; i < this.nodes.length; i++) {
        if (
          this.nodes[i].type === "hidden" || this.nodes[i].type === "constant"
        ) {
          this.nodes[i].mask = 1 - this.dropout;
        }
      }
    }

    return {
      error: error,
      iterations: iteration,
      time: Date.now() - start,
    };
  },

  /**
   * Performs one training epoch and returns the error
   * private function used in this.train
   */
  _trainSet: function (set, batchSize, currentRate, momentum, costFunction) {
    if (set.length == 0) throw "Set size must be positive";
    let errorSum = 0;
    for (let i = 0; i < set.length; i++) {
      const input = set[i].input;
      const target = set[i].output;

      const update = !!((i + 1) % batchSize === 0 || (i + 1) === set.length);

      const output = this.activate(input, true);
      this.propagate(currentRate, momentum, update, target);

      const cost = costFunction(target, output);
      if (!isFinite(cost)) {
        throw "Invalid cost: " + cost + " of target: " + target + " output: " +
          output + " function: " + costFunction;
      }
      errorSum += cost;
    }
    const error = errorSum / set.length;
    if (!isFinite(error)) {
      throw "Invalid error: " + error + ", len: " + set.length;
    }
    return error;
  },

  /**
   * Tests a set and returns the error and elapsed time
   */
  test: function (set, cost = Methods.cost.MSE) {
    // Check if dropout is enabled, set correct mask

    if (this.dropout) {
      for (let i = this.nodes.length; i--;) {
        if (
          this.nodes[i].type === "hidden" || this.nodes[i].type === "constant"
        ) {
          this.nodes[i].mask = 1 - this.dropout;
        }
      }
    }

    let error = 0;

    const len = set.length;
    for (let i = 0; i < len; i++) { // Order matters for some reason.
      const input = set[i].input;
      const target = set[i].output;
      const output = this.noTraceActivate(input);
      error += cost(target, output);
    }

    error /= len;
    const results = {
      error: error,
    };

    return results;
  },

  /**
   * Creates a json that can be used to create a graph with d3 and webcola
   */
  graph: function (width, height) {
    let input = 0;
    let output = 0;

    const json = {
      nodes: [],
      links: [],
      constraints: [{
        type: "alignment",
        axis: "x",
        offsets: [],
      }, {
        type: "alignment",
        axis: "y",
        offsets: [],
      }],
    };

    let i;
    for (i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];

      if (node.type === "input") {
        if (this.input === 1) {
          json.constraints[0].offsets.push({
            node: i,
            offset: 0,
          });
        } else {
          json.constraints[0].offsets.push({
            node: i,
            offset: 0.8 * width / (this.input - 1) * input++,
          });
        }
        json.constraints[1].offsets.push({
          node: i,
          offset: 0,
        });
      } else if (node.type === "output") {
        if (this.output === 1) {
          json.constraints[0].offsets.push({
            node: i,
            offset: 0,
          });
        } else {
          json.constraints[0].offsets.push({
            node: i,
            offset: 0.8 * width / (this.output - 1) * output++,
          });
        }
        json.constraints[1].offsets.push({
          node: i,
          offset: -0.8 * height,
        });
      }

      json.nodes.push({
        id: i,
        name: node.type === "hidden"
          ? node.squash.name
          : node.type.toUpperCase(),
        activation: node.activation,
        bias: node.bias,
      });
    }

    const connections = this.connections.concat(this.selfconns);
    for (i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.gater == null) {
        json.links.push({
          source: this.nodes.indexOf(connection.from),
          target: this.nodes.indexOf(connection.to),
          weight: connection.weight,
        });
      } else {
        // Add a gater 'node'
        const index = json.nodes.length;
        json.nodes.push({
          id: index,
          activation: connection.gater.activation,
          name: "GATE",
        });
        json.links.push({
          source: this.nodes.indexOf(connection.from),
          target: index,
          weight: 1 / 2 * connection.weight,
        });
        json.links.push({
          source: index,
          target: this.nodes.indexOf(connection.to),
          weight: 1 / 2 * connection.weight,
        });
        json.links.push({
          source: this.nodes.indexOf(connection.gater),
          target: index,
          weight: connection.gater.activation,
          gate: true,
        });
      }
    }

    return json;
  },

  /**
   * Convert the network to a json object
   */
  toJSON: function () {
    const json = {
      nodes: new Array(this.nodes.length),
      connections: [],
      input: this.input,
      output: this.output,
      dropout: this.dropout,
    };

    // So we don't have to use expensive .indexOf()

    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].index = i;
    }

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const tojson = node.toJSON();
      tojson.index = i;
      json.nodes[i] = tojson;

      if (node.connections.self.weight !== 0) {
        const tojson = node.connections.self.toJSON();
        tojson.from = i;
        tojson.to = i;

        tojson.gater = node.connections.self.gater != null
          ? node.connections.self.gater.index
          : null;
        json.connections.push(tojson);
      }
    }

    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i];
      const tojson = conn.toJSON();
      tojson.from = conn.from.index;
      tojson.to = conn.to.index;

      tojson.gater = conn.gater != null ? conn.gater.index : null;

      json.connections.push(tojson);
    }

    return json;
  },

  /**
   * Sets the value of a property for every node in this network
   */
  set: function (values) {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].bias = values.bias || this.nodes[i].bias;
      this.nodes[i].squash = values.squash || this.nodes[i].squash;
    }
  },

  /**
   * Evolves the network to reach a lower error on a dataset
   */
  evolve: async function (dataSet, options) {
    freezeAndValidate(dataSet);
    if (
      dataSet[0].input.length !== this.input ||
      dataSet[0].output.length !== this.output
    ) {
      throw new Error(
        "Dataset input/output size should be same as network input/output size!",
      );
    }

    // Read the options
    options = options || {};
    let targetError = typeof options.error !== "undefined"
      ? options.error
      : 0.05;
    const growth = typeof options.growth !== "undefined"
      ? options.growth
      : 0.0001;

    const costName = options.costName || "MSE";

    let threads = options.threads;
    if (typeof threads === "undefined") {
      if (typeof window === "undefined") { // Node.js
        threads = require("os").cpus().length;
      } else { // Browser
        threads = navigator.hardwareConcurrency;
      }
    }

    const start = Date.now();

    if (
      typeof options.iterations === "undefined" &&
      typeof options.error === "undefined"
    ) {
      throw new Error(
        "At least one of the following options must be specified: error, iterations",
      );
    } else if (typeof options.error === "undefined") {
      targetError = -1; // run until iterations
    } else if (typeof options.iterations === "undefined") {
      options.iterations = 0; // run until target error
    }

    const workers = [];

    for (let i = threads; i--;) {
      workers.push(new WorkerHandle(dataSet, costName, threads == 1));
    }

    const fitnessFunction = function (population) {
      return new Promise((resolve, reject) => {
        // Create a queue
        const queue = population.slice();

        // Start worker function
        const startWorker = async function (worker) {
          while (queue.length) {
            const genome = queue.shift();

            const result = await worker.evaluate(genome);
            genome.score = -result;
            genome.score -= (
              genome.nodes.length -
              genome.input -
              genome.output +
              genome.connections.length +
              genome.gates.length
            ) * growth;

            genome.score = isNaN(genome.score) ? -Infinity : genome.score;
          }
        };
        const promises = new Array(workers.length);
        for (let i = workers.length; i--;) {
          promises[i] = startWorker(workers[i]);
        }

        Promise.all(promises).then((r) => resolve(r)).catch((reason) =>
          reject(reason)
        );
      });
    };

    options.fitnessPopulation = true;

    // Intialise the NEAT instance
    options.network = this;
    const neat = new Neat(this.input, this.output, fitnessFunction, options);

    let error = -Infinity;
    let bestFitness = -Infinity;
    let bestGenome;

    while (
      error < -targetError &&
      (options.iterations === 0 || neat.generation < options.iterations)
    ) {
      const fittest = await neat.evolve();

      const fitness = fittest.score;
      error = fitness +
        (fittest.nodes.length - fittest.input - fittest.output +
            fittest.connections.length + fittest.gates.length) * growth;

      if (fitness > bestFitness) {
        bestFitness = fitness;
        bestGenome = fittest;
      }

      if (options.log && neat.generation % options.log === 0) {
        console.log(
          "iteration",
          neat.generation,
          "fitness",
          fitness,
          "error",
          -error,
        );
      }

      if (
        options.schedule && neat.generation % options.schedule.iterations === 0
      ) {
        options.schedule.function({
          fitness: fitness,
          error: -error,
          iteration: neat.generation,
        });
      }
    }

    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      w.terminate();
    }

    if (typeof bestGenome !== "undefined") {
      this.nodes = bestGenome.nodes;
      this.connections = bestGenome.connections;
      this.selfconns = bestGenome.selfconns;
      this.gates = bestGenome.gates;

      if (options.clear) this.clear();
    }

    return {
      error: -error,
      iterations: neat.generation,
      time: Date.now() - start,
    };
  },
};

/**
 * Convert a json object to a network
 */
Network.fromJSON = function (json) {
  const network = new Network(json.input, json.output, false);
  network.dropout = json.dropout;
  network.nodes.length=json.nodes.length;
  
  for (let i = json.nodes.length; i--;) {
    network.nodes[i] = Node.fromJSON(json.nodes[i]);
  }

  const cLen=json.connections.length;
  for (let i = 0; i<cLen; i++) {    
    const conn = json.connections[i];

    const connection =
      network.connect(network.nodes[conn.from], network.nodes[conn.to])[0];
    connection.weight = conn.weight;

    if (conn.gater != null) {
      network.gate(network.nodes[conn.gater], connection);
    }
  }

  return network;
};

/**
 * Merge two networks into one
 */
Network.merge = function (network1, network2) {
  // Create a copy of the networks
  network1 = Network.fromJSON(network1.toJSON());
  network2 = Network.fromJSON(network2.toJSON());

  // Check if output and input size are the same
  if (network1.output !== network2.input) {
    throw new Error(
      "Output size of network1 should be the same as the input size of network2!",
    );
  }

  // Redirect all connections from network2 input from network1 output
  for (let i = 0; i < network2.connections.length; i++) {
    const conn = network2.connections[i];
    if (conn.from.type === "input") {
      const index = network2.nodes.indexOf(conn.from);

      // redirect
      conn.from = network1.nodes[network1.nodes.length - 1 - index];
    }
  }

  // Delete input nodes of network2
  for (let i = network2.input - 1; i >= 0; i--) {
    network2.nodes.splice(i, 1);
  }

  // Change the node type of network1's output nodes (now hidden)
  for (
    let i = network1.nodes.length - network1.output;
    i < network1.nodes.length;
    i++
  ) {
    network1.nodes[i].type = "hidden";
  }

  // Create one network from both networks
  network1.connections = network1.connections.concat(network2.connections);
  network1.nodes = network1.nodes.concat(network2.nodes);

  return network1;
};

/**
 * Create an offspring from two parent networks
 */
Network.crossOver = function (network1, network2, equal) {
  if (
    network1.input !== network2.input || network1.output !== network2.output
  ) {
    throw new Error("Networks don't have the same input/output size!");
  }

  // Initialise offspring
  const offspring = new Network(network1.input, network1.output);
  offspring.connections = [];
  offspring.nodes = [];

  // Save scores and create a copy
  const score1 = network1.score || 0;
  const score2 = network2.score || 0;

  // Determine offspring node size
  let size;
  if (equal || score1 === score2) {
    const max = Math.max(network1.nodes.length, network2.nodes.length);
    const min = Math.min(network1.nodes.length, network2.nodes.length);
    size = Math.floor(Math.random() * (max - min + 1) + min);
  } else if (score1 > score2) {
    size = network1.nodes.length;
  } else {
    size = network2.nodes.length;
  }

  // Rename some variables for easier reading
  const outputSize = network1.output;

  // Set indexes so we don't need indexOf

  for (let i = 0; i < network1.nodes.length; i++) {
    network1.nodes[i].index = i;
  }

  for (let i = 0; i < network2.nodes.length; i++) {
    network2.nodes[i].index = i;
  }

  // Assign nodes from parents to offspring
  for (let i = 0; i < size; i++) {
    // Determine if an output node is needed
    let node;
    if (i < size - outputSize) {
      const random = Math.random();
      node = random >= 0.5 ? network1.nodes[i] : network2.nodes[i];
      const other = random < 0.5 ? network1.nodes[i] : network2.nodes[i];

      if (typeof node === "undefined" || node.type === "output") {
        node = other;
      }
    } else {
      if (Math.random() >= 0.5) {
        node = network1.nodes[network1.nodes.length + i - size];
      } else {
        node = network2.nodes[network2.nodes.length + i - size];
      }
    }

    const newNode = new Node();
    newNode.bias = node.bias;
    newNode.squash = node.squash;
    newNode.type = node.type;

    offspring.nodes.push(newNode);
  }

  // Create arrays of connection genes
  const n1conns = {};
  const n2conns = {};

  // Normal connections
  for (let i = 0; i < network1.connections.length; i++) {
    const conn = network1.connections[i];
    const data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1,
    };
    n1conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Selfconnections
  for (let i = 0; i < network1.selfconns.length; i++) {
    const conn = network1.selfconns[i];
    const data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1,
    };
    n1conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Normal connections
  for (let i = 0; i < network2.connections.length; i++) {
    const conn = network2.connections[i];
    const data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1,
    };
    n2conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Selfconnections
  for (let i = 0; i < network2.selfconns.length; i++) {
    const conn = network2.selfconns[i];
    const data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1,
    };
    n2conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Split common conn genes from disjoint or excess conn genes
  const connections = [];
  const keys1 = Object.keys(n1conns);
  const keys2 = Object.keys(n2conns);
  for (let i = keys1.length - 1; i >= 0; i--) {
    // Common gene
    if (typeof n2conns[keys1[i]] !== "undefined") {
      const conn = Math.random() >= 0.5 ? n1conns[keys1[i]] : n2conns[keys1[i]];
      connections.push(conn);

      // Because deleting is expensive, just set it to some value
      n2conns[keys1[i]] = undefined;
    } else if (score1 >= score2 || equal) {
      connections.push(n1conns[keys1[i]]);
    }
  }

  // Excess/disjoint gene
  if (score2 >= score1 || equal) {
    for (let i = 0; i < keys2.length; i++) {
      if (typeof n2conns[keys2[i]] !== "undefined") {
        connections.push(n2conns[keys2[i]]);
      }
    }
  }

  // Add common conn genes uniformly
  for (let i = 0; i < connections.length; i++) {
    const connData = connections[i];
    if (connData.to < size && connData.from < size) {
      const from = offspring.nodes[connData.from];
      const to = offspring.nodes[connData.to];
      const conn = offspring.connect(from, to)[0];

      conn.weight = connData.weight;

      if (connData.gater !== -1 && connData.gater < size) {
        offspring.gate(offspring.nodes[connData.gater], conn);
      }
    }
  }

  return offspring;
};
