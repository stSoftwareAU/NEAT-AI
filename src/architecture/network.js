import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./connection.js";
import { Node } from "./Node.js";
import { NetworkUtil } from "./NetworkUtil.ts";

/*******************************************************************************
                                 NETWORK
*******************************************************************************/

/*******************************************************************************
NETWORK
*******************************************************************************/
export class Network {
  constructor(input, output, initialise = true) {
    if (typeof input === "undefined" || typeof output === "undefined") {
      throw new Error("No input or output size given");
    }

    this.input = input;
    this.output = output;

    // Store all the node and connection genes
    const nLen = this.input + this.output;
    this.nodes = new Array(nLen); // Stored in activation order
    this.connections = [];
    this.gates = [];
    this.selfconns = [];
    this.tags = undefined;

    this.util = new NetworkUtil(this);
    // Just define a variable.
    this.score = undefined;

    if (initialise) {
      // Create input and output nodes
      for (let i = nLen; i--;) {
        const type = i < this.input ? "input" : "output";
        this.nodes[i] = new Node(type);
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
  /**
   * Activates the network
   */
  activate(input) {
    if (input && input.length != this.input) {
      console.trace();
      throw "Activate input: " + input.length +
        " does not match expected input: " + this.input;
    }
    const output = new Array(this.output);
    let outputLen = 0;

    // Activate nodes chronologically
    for (let i = 0; i < this.nodes.length; i++) {
      const _node = this.nodes[i];
      switch (_node.type) {
        case "input": {
          // if( i == 297){
          //   console.info( _node);
          // }
          _node.activate(input[i]);
          break;
        }
        case "output": {
          const activation = _node.activate();
          output[outputLen] = activation;
          outputLen++;
          break;
        }
        default:
          _node.activate();
      }
    }

    output.length = outputLen;

    return output;
  }

  /**
   * Activates the network without calculating elegibility traces and such
   */
  noTraceActivate(input) {
    const output = new Array(this.output);
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
  }

  /**
   * Clear the context of the network
   */
  clear() {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].clear();
    }
  }
  /**
   * Connects the from node to the to node
   */
  connect(from, to, weight) {
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
  }
  /**
   * Disconnects the from node from the to node
   */
  disconnect(from, to) {
    // Delete the connection in the network's connection array
    const connections = from === to ? this.selfconns : this.connections;

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        if (connection.gater !== null) {
          this.ungate(connection);
        }
        connections.splice(i, 1);
        break;
      }
    }

    // Delete the connection at the sending and receiving neuron
    from.disconnect(to);
  }
  /**
   * Gate a connection with a node
   */
  gate(node, connection) {
    if (this.nodes.indexOf(node) === -1) {
      throw new Error("This node is not part of the network!");
    } else if (connection.gater != null) {
      console.warn("This connection is already gated!");

      return;
    }
    node.gate(connection);
    this.gates.push(connection);
  }
  /**
   *  Remove the gate of a connection
   */
  ungate(connection) {
    const index = this.gates.indexOf(connection);
    if (index === -1) {
      throw new Error("This connection is not gated!");
    }

    this.gates.splice(index, 1);
    connection.gater.ungate(connection);
  }
  /**
   *  Removes a node from the network
   */
  remove(node) {
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
      if (connections.length === 0) {
        break;
      }

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
  }
  // /**
  //  * Mutates the network with the given method
  //  */
  // mutate(method) {
  //   if (typeof method === "undefined") {
  //     throw new Error("No (correct) mutate method given!");
  //   }

  //   switch (method) {
  //     case Mutation.ADD_NODE: {
  //       // Look for an existing connection and place a node in between
  //       if (this.connections.length > 0) {
  //         const pos = Math.floor(Math.random() * this.connections.length);
  //         const connection = this.connections[pos];
  //         if (connection) {
  //           const gater = connection.gater;
  //           this.disconnect(connection.from, connection.to);

  //           // Insert the new node right before the old connection.to
  //           const toIndex = this.nodes.indexOf(connection.to);
  //           const node = new Node("hidden");

  //           // Random squash function
  //           node.mutate(Mutation.MOD_ACTIVATION);

  //           // Place it in this.nodes
  //           const minBound = Math.min(toIndex, this.nodes.length - this.output);
  //           this.nodes.splice(minBound, 0, node);

  //           // Now create two new connections
  //           const newConn1 = this.connect(connection.from, node)[0];
  //           const newConn2 = this.connect(node, connection.to)[0];

  //           // Check if the original connection was gated
  //           if (gater != null) {
  //             this.gate(gater, Math.random() >= 0.5 ? newConn1 : newConn2);
  //           }
  //         } else {
  //           console.warn(
  //             "ADD_NODE: missing connection at",
  //             pos,
  //             "of",
  //             this.connections.length,
  //           );
  //         }
  //       }
  //       break;
  //     }
  //     case Mutation.SUB_NODE: {
  //       // Check if there are nodes left to remove
  //       if (this.nodes.length === this.input + this.output) {
  //         break;
  //       }

  //       // Select a node which isn't an input or output node
  //       const index = Math.floor(
  //         Math.random() * (this.nodes.length - this.output - this.input) +
  //           this.input,
  //       );
  //       this.remove(this.nodes[index]);
  //       break;
  //     }
  //     case Mutation.ADD_CONN: {
  //       // Create an array of all uncreated (feedforward) connections
  //       const available = [];
  //       for (let i = 0; i < this.nodes.length - this.output; i++) {
  //         const node1 = this.nodes[i];
  //         for (
  //           let j = Math.max(i + 1, this.input);
  //           j < this.nodes.length;
  //           j++
  //         ) {
  //           const node2 = this.nodes[j];
  //           if (!node1.isProjectingTo(node2)) {
  //             available.push([node1, node2]);
  //           }
  //         }
  //       }

  //       if (available.length === 0) {
  //         break;
  //       }

  //       const pair = available[Math.floor(Math.random() * available.length)];
  //       this.connect(pair[0], pair[1]);
  //       break;
  //     }
  //     case Mutation.SUB_CONN: {
  //       // List of possible connections that can be removed
  //       const possible = [];

  //       for (let i = 0; i < this.connections.length; i++) {
  //         const conn = this.connections[i];
  //         // Check if it is not disabling a node
  //         if (
  //           conn.from.connections.out.length > 1 &&
  //           conn.to.connections.in.length > 1 &&
  //           this.nodes.indexOf(conn.to) > this.nodes.indexOf(conn.from)
  //         ) {
  //           possible.push(conn);
  //         }
  //       }

  //       if (possible.length === 0) {
  //         break;
  //       }

  //       const randomConn =
  //         possible[Math.floor(Math.random() * possible.length)];
  //       this.disconnect(randomConn.from, randomConn.to);
  //       break;
  //     }
  //     case Mutation.MOD_WEIGHT: {
  //       const allconnections = this.connections.concat(this.selfconns);
  //       if (allconnections.length > 0) {
  //         const pos = Math.floor(Math.random() * allconnections.length);
  //         const connection = allconnections[pos];
  //         if (connection) {
  //           const modification = Math.random() * (method.max - method.min) +
  //             method.min;
  //           connection.weight += modification;
  //         } else {
  //           console.warn(
  //             "MOD_WEIGHT: missing connection at",
  //             pos,
  //             "of",
  //             allconnections.length,
  //           );
  //         }
  //       }
  //       break;
  //     }
  //     case Mutation.MOD_BIAS: {
  //       // Has no effect on input node, so they are excluded
  //       const index = Math.floor(
  //         Math.random() * (this.nodes.length - this.input) + this.input,
  //       );
  //       const node = this.nodes[index];
  //       node.mutate(method);
  //       break;
  //     }
  //     case Mutation.MOD_ACTIVATION: {
  //       // Has no effect on input node, so they are excluded
  //       if (
  //         !method.mutateOutput && this.input + this.output === this.nodes.length
  //       ) {
  //         console.warn("No nodes that allow mutation of activation function");

  //         break;
  //       }

  //       const index = Math.floor(
  //         Math.random() *
  //             (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
  //               this.input) + this.input,
  //       );
  //       const node = this.nodes[index];

  //       node.mutate(method);
  //       break;
  //     }
  //     case Mutation.ADD_SELF_CONN: {
  //       // Check which nodes aren't selfconnected yet
  //       const possible = [];
  //       for (let i = this.input; i < this.nodes.length; i++) {
  //         const node = this.nodes[i];
  //         if (node.connections.self.weight === 0) {
  //           possible.push(node);
  //         }
  //       }

  //       if (possible.length === 0) {
  //         break;
  //       }

  //       // Select a random node
  //       const node = possible[Math.floor(Math.random() * possible.length)];

  //       // Connect it to himself
  //       this.connect(node, node);
  //       break;
  //     }
  //     case Mutation.SUB_SELF_CONN: {
  //       if (this.selfconns.length === 0) {
  //         break;
  //       }
  //       const conn =
  //         this.selfconns[Math.floor(Math.random() * this.selfconns.length)];
  //       this.disconnect(conn.from, conn.to);
  //       break;
  //     }
  //     case Mutation.ADD_GATE: {
  //       const allconnections = this.connections.concat(this.selfconns);

  //       // Create a list of all non-gated connections
  //       const possible = [];
  //       for (let i = 0; i < allconnections.length; i++) {
  //         const conn = allconnections[i];
  //         if (conn.gater === null) {
  //           possible.push(conn);
  //         }
  //       }

  //       if (possible.length === 0) {
  //         break;
  //       }

  //       // Select a random gater node and connection, can't be gated by input
  //       const index = Math.floor(
  //         Math.random() * (this.nodes.length - this.input) + this.input,
  //       );
  //       const node = this.nodes[index];
  //       const conn = possible[Math.floor(Math.random() * possible.length)];

  //       // Gate the connection with the node
  //       this.gate(node, conn);
  //       break;
  //     }
  //     case Mutation.SUB_GATE: {
  //       // Select a random gated connection
  //       if (this.gates.length === 0) {
  //         break;
  //       }

  //       const index = Math.floor(Math.random() * this.gates.length);
  //       const gatedconn = this.gates[index];

  //       this.ungate(gatedconn);
  //       break;
  //     }
  //     case Mutation.ADD_BACK_CONN: {
  //       // Create an array of all uncreated (backfed) connections
  //       const available = [];
  //       for (let i = this.input; i < this.nodes.length; i++) {
  //         const node1 = this.nodes[i];
  //         for (let j = this.input; j < i; j++) {
  //           const node2 = this.nodes[j];
  //           if (!node1.isProjectingTo(node2)) {
  //             available.push([node1, node2]);
  //           }
  //         }
  //       }

  //       if (available.length === 0) {
  //         break;
  //       }

  //       const pair = available[Math.floor(Math.random() * available.length)];
  //       this.connect(pair[0], pair[1]);
  //       break;
  //     }
  //     case Mutation.SUB_BACK_CONN: {
  //       // List of possible connections that can be removed
  //       const possible = [];

  //       for (let i = 0; i < this.connections.length; i++) {
  //         const conn = this.connections[i];
  //         // Check if it is not disabling a node
  //         if (
  //           conn.from.connections.out.length > 1 &&
  //           conn.to.connections.in.length > 1 &&
  //           this.nodes.indexOf(conn.from) > this.nodes.indexOf(conn.to)
  //         ) {
  //           possible.push(conn);
  //         }
  //       }

  //       if (possible.length === 0) {
  //         break;
  //       }

  //       const randomConn =
  //         possible[Math.floor(Math.random() * possible.length)];
  //       this.disconnect(randomConn.from, randomConn.to);
  //       break;
  //     }
  //     case Mutation.SWAP_NODES: {
  //       // Has no effect on input node, so they are excluded
  //       if (
  //         (method.mutateOutput && this.nodes.length - this.input < 2) ||
  //         (!method.mutateOutput &&
  //           this.nodes.length - this.input - this.output < 2)
  //       ) {
  //         break;
  //       }

  //       let index = Math.floor(
  //         Math.random() *
  //             (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
  //               this.input) + this.input,
  //       );
  //       const node1 = this.nodes[index];
  //       index = Math.floor(
  //         Math.random() *
  //             (this.nodes.length - (method.mutateOutput ? 0 : this.output) -
  //               this.input) + this.input,
  //       );
  //       const node2 = this.nodes[index];

  //       const biasTemp = node1.bias;
  //       const squashTemp = node1.squash;

  //       node1.bias = node2.bias;
  //       node1.squash = node2.squash;
  //       node2.bias = biasTemp;
  //       node2.squash = squashTemp;
  //       break;
  //     }
  //     default: {
  //       throw "unknown: " + method;
  //     }
  //   }
  // }

  /**
   * Creates a json that can be used to create a graph with d3 and webcola
   */
  graph(width, height) {
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
  }
  /**
   * Convert the network to a json object
   */
  toJSON() {
    const json = {
      nodes: new Array(this.nodes.length),
      connections: [],
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    // So we don't have to use expensive .indexOf()
    for (let i = this.nodes.length; i--;) {
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
      const tojson = this.connections[i].toJSON();
      // const conn = this.connections[i];
      // const tojson = conn.toJSON();
      // tojson.from = conn.from.index;
      // tojson.to = conn.to.index;

      // tojson.gater = conn.gater != null ? conn.gater.index : null;

      json.connections.push(tojson);
    }

    return json;
  }
  /**
   * Sets the value of a property for every node in this network
   */
  set(values) {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].bias = values.bias || this.nodes[i].bias;
      this.nodes[i].squash = values.squash || this.nodes[i].squash;
    }
  }

  /**
   * Train the given set to this network
   */
  train(dataSet, options) {
    return this.util.train(dataSet, options);
  }

  /**
   * Evolves the network to reach a lower error on a dataset
   */
  evolve(dataSet, options) {
    return this.util.evolveDataSet(dataSet, options);
  }
  /**
   * Evolves the network to reach a lower error on a dataset
   */
  evolveDir(dataDir, options) {
    return this.util.evolveDir(dataDir, options);
  }
  /**
   * Convert a json object to a network
   */
  static fromJSON(json) {
    const network = new Network(json.input, json.output, false);
    network.nodes.length = json.nodes.length;
    network.tags = json.tags;

    for (let i = json.nodes.length; i--;) {
      network.nodes[i] = Node.fromJSON(json.nodes[i]);
    }

    const cLen = json.connections.length;
    for (let i = 0; i < cLen; i++) {
      const conn = json.connections[i];

      const connection =
        network.connect(network.nodes[conn.from], network.nodes[conn.to])[0];
      connection.weight = conn.weight;

      if (conn.gater != null) {
        network.gate(network.nodes[conn.gater], connection);
      }
    }

    return network;
  }

  /**
   * Create an offspring from two parent networks
   */
  static crossOver(network1, network2, equal) {
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
    for (let i = network1.nodes.length; i--;) {
      network1.nodes[i].index = i;
    }

    for (let i = network2.nodes.length; i--;) {
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

      if (node) {
        newNode.bias = node.bias;
        newNode.squash = node.squash;
        newNode.type = node.type;
      } else {
        console.warn("missing node");
      }
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
        const conn = Math.random() >= 0.5
          ? n1conns[keys1[i]]
          : n2conns[keys1[i]];
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
  }
}
