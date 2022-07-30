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
    // this.gates = [];
    // this.selfconns = [];
    this.tags = undefined;

    this.util = new NetworkUtil(this);
    // Just define a variable.
    this.score = undefined;

    if (initialise) {
      // Create input and output nodes
      for (let i = nLen; i--;) {
        const type = i < this.input ? "input" : "output";
        const node = new Node(type, 0, this.util);
        node.index = i;
        this.nodes[i] = node;
      }

      // Connect input nodes with output nodes directly
      for (let i = 0; i < this.input; i++) {
        for (let j = this.input; j < this.output + this.input; j++) {
          /** https://stats.stackexchange.com/a/248040/147931 */
          const weight = Math.random() * this.input * Math.sqrt(2 / this.input);
          this.util.connect(i, j, weight);
        }
      }
    }

    if (window.DEBUG && initialise) {
      this.util.validate();
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
   * Gate a connection with a node
   */
  gate(node, connection) {
    console.trace();
    throw "not done";
    // if (this.nodes.indexOf(node) === -1) {
    //   const msg = "Gate: This node is not part of the network!";
    //   console.warn(msg, node);
    //   console.trace();
    //   if (window.DEBUG == true) throw new Error(msg);

    //   return;
    // } else if (connection.gater != null) {
    //   console.warn("This connection is already gated!");

    //   return;
    // }
    // node.gate(connection);
    // this.gates.push(connection);
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

    // const connections = this.connections.concat(this.selfconns);
    for (i = 0; i < this.connections.length; i++) {
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
    if (window.DEBUG) {
      this.util.validate();
    }

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

      // if (node.connections.self && node.connections.self.weight !== 0) {
      //   const tojson = node.connections.self.toJSON();
      //   tojson.from = i;
      //   tojson.to = i;

      //   tojson.gater = node.connections.self.gater != null
      //     ? node.connections.self.gater.index
      //     : null;
      //   json.connections.push(tojson);
      // }
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

    const util = new NetworkUtil(network);

    for (let i = json.nodes.length; i--;) {
      const n = Node.fromJSON(json.nodes[i], util);
      n.index = i;
      network.nodes[i] = n;
    }

    const cLen = json.connections.length;
    for (let i = 0; i < cLen; i++) {
      const conn = json.connections[i];

      const connection = network.util.connect(
        conn.from,
        conn.to,
        conn.weight,
        conn.type,
      );

      if (conn.gater != null) {
        network.gate(network.nodes[conn.gater], connection);
      }
    }

    if (window.DEBUG) {
      network.util.validate();
    }

    return network;
  }
}
