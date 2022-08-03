/* Import */
import { Node } from "./Node.ts";
import { Network } from "./network.js";
import { Group } from "./group.js";
import { Layer } from "./layer.js";
import { Methods } from "../methods/methods.js";
import { Mutation } from "../methods/mutation.ts";
import { STEP } from "../methods/activations/types/STEP.ts";

/*******************************************************************************
                                        architect
*******************************************************************************/

export const architect = {
  /**
   * Constructs a network from a given array of connected nodes
   */
  Construct: function (list) {
    // Create a network
    const network = new Network(0, 0);

    // Transform all groups into nodes
    let nodes = [];

    let i;
    for (i = 0; i < list.length; i++) {
      let j;
      if (list[i] instanceof Group) {
        for (j = 0; j < list[i].nodes.length; j++) {
          nodes.push(list[i].nodes[j]);
        }
      } else if (list[i] instanceof Layer) {
        for (j = 0; j < list[i].nodes.length; j++) {
          for (let k = 0; k < list[i].nodes[j].nodes.length; k++) {
            nodes.push(list[i].nodes[j].nodes[k]);
          }
        }
      } else if (list[i] instanceof Node) {
        nodes.push(list[i]);
      }
    }

    // Determine input and output nodes
    const inputs = [];
    const outputs = [];
    for (i = nodes.length - 1; i >= 0; i--) {
      if (
        nodes[i].type === "output" ||
        nodes[i].connections.out.length + nodes[i].connections.gated.length ===
          0
      ) {
        nodes[i].type = "output";
        network.output++;
        outputs.push(nodes[i]);
        nodes.splice(i, 1);
      } else if (nodes[i].type === "input" || !nodes[i].connections.in.length) {
        nodes[i].type = "input";
        network.input++;
        inputs.push(nodes[i]);
        nodes.splice(i, 1);
      }
    }

    // Input nodes are always first, output nodes are always last
    nodes = inputs.concat(nodes).concat(outputs);

    if (network.input === 0 || network.output === 0) {
      throw new Error("Given nodes have no clear input/output node!");
    }

    // for (i = 0; i < nodes.length; i++) {
    //   let j;
    //   for (j = 0; j < nodes[i].connections.out.length; j++) {
    //     network.connections.push(nodes[i].connections.out[j]);
    //   }
    //   for (j = 0; j < nodes[i].connections.gated.length; j++) {
    //     network.gates.push(nodes[i].connections.gated[j]);
    //   }
    //   if (nodes[i].connections.self.weight !== 0) {
    //     network.selfconns.push(nodes[i].connections.self);
    //   }
    // }

    network.nodes = nodes;

    return network;
  },

  /**
   * Creates a multilayer perceptron (MLP)
   */
  // Perceptron: function () {
  //   // Convert arguments to Array
  //   const layers = Array.prototype.slice.call(arguments);
  //   if (layers.length < 3) {
  //     throw new Error("You have to specify at least 3 layers");
  //   }

  //   // Create a list of nodes/groups
  //   const nodes = [];
  //   nodes.push(new Group(layers[0]));

  //   for (let i = 1; i < layers.length; i++) {
  //     let layer = layers[i];
  //     layer = new Group(layer);
  //     nodes.push(layer);
  //     nodes[i - 1].connect(nodes[i], Methods.connection.ALL_TO_ALL);
  //   }

  //   // Construct the network
  //   return architect.Construct(nodes);
  // },

  /**
   * Creates a randomly connected network
   */
  Random: function (input, hidden, output, options) {
    options = options || {};

    const connections = options.connections || hidden * 2;
    const backconnections = options.backconnections || 0;
    const selfconnections = options.selfconnections || 0;
    const gates = options.gates || 0;

    const network = new Network(input, output);

    for (let i = 0; i < hidden; i++) {
      network.util.mutate(Mutation.ADD_NODE);
    }

    for (let i = 0; i < connections - hidden; i++) {
      network.util.mutate(Mutation.ADD_CONN);
    }

    for (let i = 0; i < backconnections; i++) {
      network.util.mutate(Mutation.ADD_BACK_CONN);
    }

    for (let i = 0; i < selfconnections; i++) {
      network.util.mutate(Mutation.ADD_SELF_CONN);
    }

    for (let i = 0; i < gates; i++) {
      network.util.mutate(Mutation.ADD_GATE);
    }

    network.util.fix();

    if (Window.DEBUG) {
      network.util.validate();
    }
    return network;
  },
  // /**
  //  * Creates a long short-term memory network
  //  */
  // LSTM: function () {
  //   const args = Array.prototype.slice.call(arguments);
  //   if (args.length < 3) {
  //     throw new Error("You have to specify at least 3 layers");
  //   }

  //   let last = args.pop();

  //   let outputLayer;
  //   if (typeof last === "number") {
  //     outputLayer = new Group(last);
  //     last = {};
  //   } else {
  //     outputLayer = new Group(args.pop()); // last argument
  //   }

  //   outputLayer.set({
  //     type: "output",
  //   });

  //   const options = {};
  //   options.memoryToMemory = last.memoryToMemory || false;
  //   options.outputToMemory = last.outputToMemory || false;
  //   options.outputToGates = last.outputToGates || false;
  //   options.inputToOutput = last.inputToOutput === undefined
  //     ? true
  //     : last.inputToOutput;
  //   options.inputToDeep = last.inputToDeep === undefined
  //     ? true
  //     : last.inputToDeep;

  //   const inputLayer = new Group(args.shift()); // first argument
  //   inputLayer.set({
  //     type: "input",
  //   });

  //   const blocks = args; // all the arguments in the middle

  //   const nodes = [];
  //   nodes.push(inputLayer);

  //   let previous = inputLayer;
  //   for (let i = 0; i < blocks.length; i++) {
  //     const block = blocks[i];

  //     // Init required nodes (in activation order)
  //     const inputGate = new Group(block);
  //     const forgetGate = new Group(block);
  //     const memoryCell = new Group(block);
  //     const outputGate = new Group(block);
  //     const outputBlock = i === blocks.length - 1
  //       ? outputLayer
  //       : new Group(block);

  //     inputGate.set({
  //       bias: 1,
  //     });
  //     forgetGate.set({
  //       bias: 1,
  //     });
  //     outputGate.set({
  //       bias: 1,
  //     });

  //     // Connect the input with all the nodes
  //     const input = previous.connect(memoryCell, Methods.connection.ALL_TO_ALL);
  //     previous.connect(inputGate, Methods.connection.ALL_TO_ALL);
  //     previous.connect(outputGate, Methods.connection.ALL_TO_ALL);
  //     previous.connect(forgetGate, Methods.connection.ALL_TO_ALL);

  //     // Set up internal connections
  //     memoryCell.connect(inputGate, Methods.connection.ALL_TO_ALL);
  //     memoryCell.connect(forgetGate, Methods.connection.ALL_TO_ALL);
  //     memoryCell.connect(outputGate, Methods.connection.ALL_TO_ALL);
  //     const forget = memoryCell.connect(
  //       memoryCell,
  //       Methods.connection.ONE_TO_ONE,
  //     );
  //     const output = memoryCell.connect(
  //       outputBlock,
  //       Methods.connection.ALL_TO_ALL,
  //     );

  //     // Set up gates
  //     inputGate.gate(input, Methods.gating.INPUT);
  //     forgetGate.gate(forget, Methods.gating.SELF);
  //     outputGate.gate(output, Methods.gating.OUTPUT);

  //     // Input to all memory cells
  //     if (options.inputToDeep && i > 0) {
  //       const input = inputLayer.connect(
  //         memoryCell,
  //         Methods.connection.ALL_TO_ALL,
  //       );
  //       inputGate.gate(input, Methods.gating.INPUT);
  //     }

  //     // Optional connections
  //     if (options.memoryToMemory) {
  //       const input = memoryCell.connect(
  //         memoryCell,
  //         Methods.connection.ALL_TO_ELSE,
  //       );
  //       inputGate.gate(input, Methods.gating.INPUT);
  //     }

  //     if (options.outputToMemory) {
  //       const input = outputLayer.connect(
  //         memoryCell,
  //         Methods.connection.ALL_TO_ALL,
  //       );
  //       inputGate.gate(input, Methods.gating.INPUT);
  //     }

  //     if (options.outputToGates) {
  //       outputLayer.connect(inputGate, Methods.connection.ALL_TO_ALL);
  //       outputLayer.connect(forgetGate, Methods.connection.ALL_TO_ALL);
  //       outputLayer.connect(outputGate, Methods.connection.ALL_TO_ALL);
  //     }

  //     // Add to array
  //     nodes.push(inputGate);
  //     nodes.push(forgetGate);
  //     nodes.push(memoryCell);
  //     nodes.push(outputGate);
  //     if (i !== blocks.length - 1) nodes.push(outputBlock);

  //     previous = outputBlock;
  //   }

  //   // input to output direct connection
  //   if (options.inputToOutput) {
  //     inputLayer.connect(outputLayer, Methods.connection.ALL_TO_ALL);
  //   }

  //   nodes.push(outputLayer);
  //   return architect.Construct(nodes);
  // },

  // /**
  //  * Creates a gated recurrent unit network
  //  */
  // GRU: function () {
  //   const args = Array.prototype.slice.call(arguments);
  //   if (args.length < 3) {
  //     throw new Error("not enough layers (minimum 3) !!");
  //   }

  //   const inputLayer = new Group(args.shift()); // first argument
  //   const outputLayer = new Group(args.pop()); // last argument
  //   const blocks = args; // all the arguments in the middle

  //   const nodes = [];
  //   nodes.push(inputLayer);

  //   let previous = inputLayer;
  //   for (let i = 0; i < blocks.length; i++) {
  //     const layer = Layer.GRU(blocks[i]);
  //     previous.connect(layer);
  //     previous = layer;

  //     nodes.push(layer);
  //   }

  //   previous.connect(outputLayer);
  //   nodes.push(outputLayer);

  //   return architect.Construct(nodes);
  // },

  // /**
  //  * Creates a hopfield network of the given size
  //  */
  // Hopfield: function (size) {
  //   const input = new Group(size);
  //   const output = new Group(size);

  //   input.connect(output, Methods.connection.ALL_TO_ALL);

  //   input.set({
  //     type: "input",
  //   });
  //   output.set({
  //     squash: STEP.name,
  //     type: "output",
  //   });

  //   const network = new architect.Construct([input, output]);

  //   return network;
  // },

  // /**
  //  * Creates a NARX network (remember previous inputs/outputs)
  //  */
  // NARX: function (
  //   inputSize,
  //   hiddenLayers,
  //   outputSize,
  //   previousInput,
  //   previousOutput,
  // ) {
  //   if (!Array.isArray(hiddenLayers)) {
  //     hiddenLayers = [hiddenLayers];
  //   }

  //   const nodes = [];

  //   const input = Layer.Dense(inputSize);
  //   const inputMemory = Layer.Memory(inputSize, previousInput);
  //   const hidden = [];
  //   const output = Layer.Dense(outputSize);
  //   const outputMemory = Layer.Memory(outputSize, previousOutput);

  //   nodes.push(input);
  //   nodes.push(outputMemory);

  //   for (let i = 0; i < hiddenLayers.length; i++) {
  //     const hiddenLayer = Layer.Dense(hiddenLayers[i]);
  //     hidden.push(hiddenLayer);
  //     nodes.push(hiddenLayer);
  //     if (typeof hidden[i - 1] !== "undefined") {
  //       hidden[i - 1].connect(hiddenLayer, Methods.connection.ALL_TO_ALL);
  //     }
  //   }

  //   nodes.push(inputMemory);
  //   nodes.push(output);

  //   input.connect(hidden[0], Methods.connection.ALL_TO_ALL);
  //   input.connect(inputMemory, Methods.connection.ONE_TO_ONE, 1);
  //   inputMemory.connect(hidden[0], Methods.connection.ALL_TO_ALL);
  //   hidden[hidden.length - 1].connect(output, Methods.connection.ALL_TO_ALL);
  //   output.connect(outputMemory, Methods.connection.ONE_TO_ONE, 1);
  //   outputMemory.connect(hidden[0], Methods.connection.ALL_TO_ALL);

  //   input.set({
  //     type: "input",
  //   });
  //   output.set({
  //     type: "output",
  //   });

  //   return architect.Construct(nodes);
  // },
};

// /* Export */
// module.exports = architect;
