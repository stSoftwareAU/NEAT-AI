import type { MutationInterface, MutationType } from "./MutationInterface.ts";

/**
 * Mutation strategies used in genetic algorithms.
 */
export const Mutation: MutationType = Object.freeze({
  /**
   * Mutation strategy to add a new node.
   */
  ADD_NODE: Object.freeze<MutationInterface>({
    name: "ADD_NODE",
  }),
  /**
   * Mutation strategy to remove a node.
   */
  SUB_NODE: Object.freeze<MutationInterface>({
    name: "SUB_NODE",
  }),
  /**
   * Mutation strategy to add a new connection between nodes.
   */
  ADD_CONN: Object.freeze<MutationInterface>({
    name: "ADD_CONN",
  }),
  /**
   * Mutation strategy to remove a connection between nodes.
   */
  SUB_CONN: Object.freeze<MutationInterface>({
    name: "SUB_CONN",
  }),
  /**
   * Mutation strategy to modify the weight of a connection.
   */
  MOD_WEIGHT: Object.freeze<MutationInterface>({
    name: "MOD_WEIGHT",
  }),
  /**
   * Mutation strategy to modify the bias of a node.
   */
  MOD_BIAS: Object.freeze<MutationInterface>({
    name: "MOD_BIAS",
  }),
  /**
   * Mutation strategy to modify the activation function of a node.
   */
  MOD_ACTIVATION: Object.freeze<MutationInterface>({
    name: "MOD_ACTIVATION",
  }),
  /**
   * Mutation strategy to add a self-connection to a node.
   */
  ADD_SELF_CONN: Object.freeze<MutationInterface>({
    name: "ADD_SELF_CONN",
  }),
  /**
   * Mutation strategy to remove a self-connection from a node.
   */
  SUB_SELF_CONN: Object.freeze<MutationInterface>({
    name: "SUB_SELF_CONN",
  }),
  /**
   * Mutation strategy to add a back-connection between nodes (from a later layer to an earlier layer).
   */
  ADD_BACK_CONN: Object.freeze<MutationInterface>({
    name: "ADD_BACK_CONN",
  }),
  /**
   * Mutation strategy to remove a back-connection between nodes.
   */
  SUB_BACK_CONN: Object.freeze<MutationInterface>({
    name: "SUB_BACK_CONN",
  }),
  /**
   * Mutation strategy to swap two nodes.
   */
  SWAP_NODES: Object.freeze<MutationInterface>({
    name: "SWAP_NODES",
  }),

  /**
   * Forward Feed mutations, a subset of mutation strategies focusing on forward connections.
   */
  FFW: Object.freeze<readonly MutationInterface[]>([
    { name: "ADD_NODE" },
    { name: "SUB_NODE" },
    { name: "ADD_CONN" },
    { name: "SUB_CONN" },
    { name: "MOD_WEIGHT" },
    { name: "MOD_BIAS" },
    { name: "MOD_ACTIVATION" },
    { name: "SWAP_NODES" },
  ]),

  /**
   * All possible mutations, including self and back connections.
   */
  ALL: Object.freeze<readonly MutationInterface[]>([
    { name: "ADD_NODE" },
    { name: "SUB_NODE" },
    { name: "ADD_CONN" },
    { name: "SUB_CONN" },
    { name: "MOD_WEIGHT" },
    { name: "MOD_BIAS" },
    { name: "MOD_ACTIVATION" },
    { name: "SWAP_NODES" },
    { name: "ADD_SELF_CONN" },
    { name: "SUB_SELF_CONN" },
    { name: "ADD_BACK_CONN" },
    { name: "SUB_BACK_CONN" },
  ]),
});

/**
 * Freezing the Mutation object to ensure immutability.
 */
Object.freeze(Mutation);
