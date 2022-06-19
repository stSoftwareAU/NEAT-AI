/* Import */
import { Methods } from "../methods/methods.js";
import { Group } from "./group.js";
import { Node } from "./Node.ts";

/*******************************************************************************
                                         Group
*******************************************************************************/

/*******************************************************************************
Group
*******************************************************************************/
export class Layer {
  constructor() {
    this.output = null;

    this.nodes = [];
    this.connections = { in: [], out: [], self: [] };
  }
  /**
   * Activates all the nodes in the group
   */
  activate(value) {
    const values = [];

    if (typeof value !== "undefined" && value.length !== this.nodes.length) {
      throw new Error(
        "Array with values should be same as the amount of nodes!",
      );
    }

    for (let i = 0; i < this.nodes.length; i++) {
      let activation;
      if (typeof value === "undefined") {
        activation = this.nodes[i].activate();
      } else {
        activation = this.nodes[i].activate(value[i]);
      }

      values.push(activation);
    }

    return values;
  }
  /**
   * Propagates all the node in the group
   */
  propagate(rate, momentum, target) {
    if (typeof target !== "undefined" && target.length !== this.nodes.length) {
      throw new Error(
        "Array with values should be same as the amount of nodes!",
      );
    }

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (typeof target === "undefined") {
        this.nodes[i].propagate(rate, momentum);
      } else {
        this.nodes[i].propagate(rate, momentum, target[i]);
      }
    }
  }
  /**
   * Connects the nodes in this group to nodes in another group or just a node
   */
  connect(target, method, weight) {
    let connections;
    if (target instanceof Group || target instanceof Node) {
      connections = this.output.connect(target, method, weight);
    } else if (target instanceof Layer) {
      connections = target.input(this, method, weight);
    }

    return connections;
  }
  /**
   * Make nodes from this group gate the given connection(s)
   */
  gate(connections, method) {
    this.output.gate(connections, method);
  }
  /**
   * Sets the value of a property for every node
   */
  set(values) {
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];

      if (node instanceof Node) {
        if (typeof values.bias !== "undefined") {
          node.bias = values.bias;
        }

        node.squash = values.squash || node.squash;
        node.type = values.type || node.type;
      } else if (node instanceof Group) {
        node.set(values);
      }
    }
  }
  /**
   * Disconnects all nodes from this group from another given group/node
   */
  disconnect(target, twosided) {
    twosided = twosided || false;

    // In the future, disconnect will return a connection so indexOf can be used
    let i, j, k;
    if (target instanceof Group) {
      for (i = 0; i < this.nodes.length; i++) {
        for (j = 0; j < target.nodes.length; j++) {
          this.nodes[i].disconnect(target.nodes[j], twosided);

          for (k = this.connections.out.length - 1; k >= 0; k--) {
            const conn = this.connections.out[k];

            if (conn.from === this.nodes[i] && conn.to === target.nodes[j]) {
              this.connections.out.splice(k, 1);
              break;
            }
          }

          if (twosided) {
            for (k = this.connections.in.length - 1; k >= 0; k--) {
              const conn = this.connections.in[k];

              if (conn.from === target.nodes[j] && conn.to === this.nodes[i]) {
                this.connections.in.splice(k, 1);
                break;
              }
            }
          }
        }
      }
    } else if (target instanceof Node) {
      for (i = 0; i < this.nodes.length; i++) {
        this.nodes[i].disconnect(target, twosided);

        for (j = this.connections.out.length - 1; j >= 0; j--) {
          const conn = this.connections.out[j];

          if (conn.from === this.nodes[i] && conn.to === target) {
            this.connections.out.splice(j, 1);
            break;
          }
        }

        if (twosided) {
          for (k = this.connections.in.length - 1; k >= 0; k--) {
            const conn = this.connections.in[k];

            if (conn.from === target && conn.to === this.nodes[i]) {
              this.connections.in.splice(k, 1);
              break;
            }
          }
        }
      }
    }
  }
  /**
   * Clear the context of this group
   */
  clear() {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].clear();
    }
  }
  static Dense(size) {
    // Create the layer
    const layer = new Layer();

    // Init required nodes (in activation order)
    const block = new Group(size);

    layer.nodes.push(block);
    layer.output = block;

    layer.input = function (from, method, weight) {
      if (from instanceof Layer) {
        from = from.output;
      }
      method = method || methods.connection.ALL_TO_ALL;
      return from.connect(block, method, weight);
    };

    return layer;
  }
  static LSTM(size) {
    // Create the layer
    const layer = new Layer();

    // Init required nodes (in activation order)
    const inputGate = new Group(size);
    const forgetGate = new Group(size);
    const memoryCell = new Group(size);
    const outputGate = new Group(size);
    const outputBlock = new Group(size);

    inputGate.set({
      bias: 1,
    });
    forgetGate.set({
      bias: 1,
    });
    outputGate.set({
      bias: 1,
    });

    // Set up internal connections
    memoryCell.connect(inputGate, methods.connection.ALL_TO_ALL);
    memoryCell.connect(forgetGate, methods.connection.ALL_TO_ALL);
    memoryCell.connect(outputGate, methods.connection.ALL_TO_ALL);
    const forget = memoryCell.connect(
      memoryCell,
      methods.connection.ONE_TO_ONE,
    );
    const output = memoryCell.connect(
      outputBlock,
      methods.connection.ALL_TO_ALL,
    );

    // Set up gates
    forgetGate.gate(forget, methods.gating.SELF);
    outputGate.gate(output, methods.gating.OUTPUT);

    // Add to nodes array
    layer.nodes = [inputGate, forgetGate, memoryCell, outputGate, outputBlock];

    // Define output
    layer.output = outputBlock;

    layer.input = function (from, method, weight) {
      if (from instanceof Layer) {
        from = from.output;
      }
      method = method || methods.connection.ALL_TO_ALL;
      const connections = [];

      const input = from.connect(memoryCell, method, weight);
      connections = connections.concat(input);

      connections = connections.concat(from.connect(inputGate, method, weight));
      connections = connections.concat(
        from.connect(outputGate, method, weight),
      );
      connections = connections.concat(
        from.connect(forgetGate, method, weight),
      );

      inputGate.gate(input, methods.gating.INPUT);

      return connections;
    };

    return layer;
  }
  static GRU(size) {
    // Create the layer
    const layer = new Layer();

    const updateGate = new Group(size);
    const inverseUpdateGate = new Group(size);
    const resetGate = new Group(size);
    const memoryCell = new Group(size);
    const output = new Group(size);
    const previousOutput = new Group(size);

    previousOutput.set({
      bias: 0,
      squash: Methods.activation.IDENTITY,
      type: "constant",
    });
    memoryCell.set({
      squash: Methods.activation.TANH,
    });
    inverseUpdateGate.set({
      bias: 0,
      squash: Methods.activation.INVERSE,
      type: "constant",
    });
    updateGate.set({
      bias: 1,
    });
    resetGate.set({
      bias: 0,
    });

    // Update gate calculation
    previousOutput.connect(updateGate, Methods.connection.ALL_TO_ALL);

    // Inverse update gate calculation
    updateGate.connect(inverseUpdateGate, Methods.connection.ONE_TO_ONE, 1);

    // Reset gate calculation
    previousOutput.connect(resetGate, Methods.connection.ALL_TO_ALL);

    // Memory calculation
    const reset = previousOutput.connect(
      memoryCell,
      Methods.connection.ALL_TO_ALL,
    );

    resetGate.gate(reset, Methods.gating.OUTPUT); // gate

    // Output calculation
    const update1 = previousOutput.connect(
      output,
      Methods.connection.ALL_TO_ALL,
    );
    const update2 = memoryCell.connect(output, Methods.connection.ALL_TO_ALL);

    updateGate.gate(update1, Methods.gating.OUTPUT);
    inverseUpdateGate.gate(update2, Methods.gating.OUTPUT);

    // Previous output calculation
    output.connect(previousOutput, Methods.connection.ONE_TO_ONE, 1);

    // Add to nodes array
    layer.nodes = [
      updateGate,
      inverseUpdateGate,
      resetGate,
      memoryCell,
      output,
      previousOutput,
    ];

    layer.output = output;

    layer.input = function (from, method, weight) {
      if (from instanceof Layer) {
        from = from.output;
      }
      method = method || Methods.connection.ALL_TO_ALL;
      let connections = [];

      connections = connections.concat(
        from.connect(updateGate, method, weight),
      );
      connections = connections.concat(from.connect(resetGate, method, weight));
      connections = connections.concat(
        from.connect(memoryCell, method, weight),
      );

      return connections;
    };

    return layer;
  }
  static Memory(size, memory) {
    // Create the layer
    const layer = new Layer();
    // Because the output can only be one group, we have to put the nodes all in óne group
    let previous = null;
    let i;
    for (i = 0; i < memory; i++) {
      const block = new Group(size);

      block.set({
        squash: Methods.activation.IDENTITY,
        bias: 0,
        type: "constant",
      });

      if (previous != null) {
        previous.connect(block, Methods.connection.ONE_TO_ONE, 1);
      }

      layer.nodes.push(block);
      previous = block;
    }

    layer.nodes.reverse();

    for (i = 0; i < layer.nodes.length; i++) {
      layer.nodes[i].nodes.reverse();
    }

    // Because output can only be óne group, fit all memory nodes in óne group
    const outputGroup = new Group(0);
    for (const group in layer.nodes) {
      outputGroup.nodes = outputGroup.nodes.concat(layer.nodes[group].nodes);
    }
    layer.output = outputGroup;

    layer.input = function (from, method, _weight) {
      if (from instanceof Layer) {
        from = from.output;
      }
      method = method || Methods.connection.ALL_TO_ALL;

      if (
        from.nodes.length !== layer.nodes[layer.nodes.length - 1].nodes.length
      ) {
        throw new Error("Previous layer size must be same as memory size");
      }

      return from.connect(
        layer.nodes[layer.nodes.length - 1],
        Methods.connection.ONE_TO_ONE,
        1,
      );
    };

    return layer;
  }
}
