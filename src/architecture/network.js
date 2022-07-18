import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./Connection.ts";
import { Node } from "./Node.ts";
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
      const msg = "Gate: This node is not part of the network!";
      console.warn(msg, node);
      console.trace();
      if (window.DEBUG == true) throw new Error(msg);

      return;
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
      console.warn("This connection is not gated!", this.gates, connection);
      console.trace();
      return;
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
      const msg = "Remove: This node does not exist in the network!";
      console.warn(msg, node);
      if (window.DEBUG == true) throw new Error(msg);

      return;
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
    if (json.tags) {
      network.tags = [...json.tags];
    }

    for (let i = json.nodes.length; i--;) {
      const n = Node.fromJSON(json.nodes[i]);

      network.nodes[i] = n;
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
  static crossOver(network1, network2) {
    if (
      network1.input !== network2.input || network1.output !== network2.output
    ) {
      throw new Error("Networks don't have the same input/output size!");
    }

    // Initialise offspring
    const offspring = new Network(network1.input, network1.output);
    offspring.connections = [];
    offspring.nodes = [];

    // // Save scores and create a copy
    // const score1 = network1.score || 0;
    // const score2 = network2.score || 0;

    // Determine offspring node size
     
    // if (equal || score1 === score2) {
      const max = Math.max(network1.nodes.length, network2.nodes.length);
      const min = Math.min(network1.nodes.length, network2.nodes.length);
    const  size = Math.floor(Math.random() * (max - min + 1) + min);
    // } else if (score1 > score2) {
    //   size = network1.nodes.length;
    // } else {
    //   size = network2.nodes.length;
    // }

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
      } else {
        connections.push(n1conns[keys1[i]]);
      }
    }

    // Excess/disjoint gene
 
      for (let i = 0; i < keys2.length; i++) {
        if (typeof n2conns[keys2[i]] !== "undefined") {
          connections.push(n2conns[keys2[i]]);
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
