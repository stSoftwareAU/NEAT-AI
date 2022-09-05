import { NetworkUtil } from "./NetworkUtil.ts";

export class Network {
  constructor(input, output, options = {}) {
    if (typeof input === "undefined" || typeof output === "undefined") {
      throw new Error("No input or output size given");
    }

    this.input = input;
    this.output = output;
    this.nodes = [];
    this.connections = [];

    this.tags = undefined;

    this.util = new NetworkUtil(this);
    // Just define a variable.
    this.score = undefined;

    if (options) {
      this.util.initialize(options);

      if (this.util.DEBUG) {
        this.util.validate();
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
    return output;
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
  toJSON(options = { verbose: false }) {
    return this.util.toJSON(options);
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

  static fromJSON(json) {
    return NetworkUtil.fromJSON(json);
  }
}
