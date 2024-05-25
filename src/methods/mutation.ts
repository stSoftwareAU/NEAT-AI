/**
 * Interface for defining mutation strategies in genetic algorithms.
 */
export interface MutationInterface {
  /** Name of the mutation strategy. */
  name: string;
}

// https://en.wikipedia.org/wiki/Mutation_(genetic_algorithm)
const temp = {
  /**
   * Mutation strategy to add a new node.
   */
  ADD_NODE: {
    name: "ADD_NODE",
  },
  /**
   * Mutation strategy to remove a node.
   */
  SUB_NODE: {
    name: "SUB_NODE",
  },
  /**
   * Mutation strategy to add a new connection between nodes.
   */
  ADD_CONN: {
    name: "ADD_CONN",
  },
  /**
   * Mutation strategy to remove a connection between nodes.
   */
  SUB_CONN: {
    name: "SUB_CONN",
  },
  /**
   * Mutation strategy to modify the weight of a connection.
   */
  MOD_WEIGHT: {
    name: "MOD_WEIGHT",
  },
  /**
   * Mutation strategy to modify the bias of a node.
   */
  MOD_BIAS: {
    name: "MOD_BIAS",
  },
  /**
   * Mutation strategy to modify the activation function of a node.
   */
  MOD_ACTIVATION: {
    name: "MOD_ACTIVATION",
  },
  /**
   * Mutation strategy to add a self-connection to a node.
   */
  ADD_SELF_CONN: {
    name: "ADD_SELF_CONN",
  },
  /**
   * Mutation strategy to remove a self-connection from a node.
   */
  SUB_SELF_CONN: {
    name: "SUB_SELF_CONN",
  },
  /**
   * Mutation strategy to add a back-connection between nodes (from a later layer to an earlier layer).
   */
  ADD_BACK_CONN: {
    name: "ADD_BACK_CONN",
  },
  /**
   * Mutation strategy to remove a back-connection between nodes.
   */
  SUB_BACK_CONN: {
    name: "SUB_BACK_CONN",
  },
  /**
   * Mutation strategy to swap two nodes.
   */
  SWAP_NODES: {
    name: "SWAP_NODES",
  },
};

/**
 * Mutation strategies used in genetic algorithms.
 */
export const Mutation = {
  ADD_NODE: temp.ADD_NODE,
  SUB_NODE: temp.SUB_NODE,
  ADD_CONN: temp.ADD_CONN,
  SUB_CONN: temp.SUB_CONN,
  MOD_WEIGHT: temp.MOD_WEIGHT,
  MOD_BIAS: temp.MOD_BIAS,
  MOD_ACTIVATION: temp.MOD_ACTIVATION,
  ADD_SELF_CONN: temp.ADD_SELF_CONN,
  SUB_SELF_CONN: temp.SUB_SELF_CONN,
  ADD_BACK_CONN: temp.ADD_BACK_CONN,
  SUB_BACK_CONN: temp.SUB_BACK_CONN,
  SWAP_NODES: temp.SWAP_NODES,

  /**
   * Forward Feed mutations, a subset of mutation strategies focusing on forward connections.
   */
  FFW: [
    temp.ADD_NODE,
    temp.SUB_NODE,
    temp.ADD_CONN,
    temp.SUB_CONN,
    temp.MOD_WEIGHT,
    temp.MOD_BIAS,
    temp.MOD_ACTIVATION,
    temp.SWAP_NODES,
  ],

  /**
   * All possible mutations, including self and back connections.
   */
  ALL: [
    temp.ADD_NODE,
    temp.SUB_NODE,
    temp.ADD_CONN,
    temp.SUB_CONN,
    temp.MOD_WEIGHT,
    temp.MOD_BIAS,
    temp.MOD_ACTIVATION,
    temp.SWAP_NODES,
    temp.ADD_SELF_CONN,
    temp.SUB_SELF_CONN,
    temp.ADD_BACK_CONN,
    temp.SUB_BACK_CONN,
  ],
};
