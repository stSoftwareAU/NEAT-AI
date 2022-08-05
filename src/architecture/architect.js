/* Import */
import { Network } from "./network.js";
import { Mutation } from "../methods/mutation.ts";

/*******************************************************************************
                                        architect
*******************************************************************************/

export const architect = {
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

    if (globalThis.DEBUG) {
      network.util.validate();
    }
    return network;
  },
};
