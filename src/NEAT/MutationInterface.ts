/**
 * Interface for defining mutation strategies in genetic algorithms.
 */
export interface MutationInterface {
  /** Name of the mutation strategy. */
  name: string;
}

/**
 * Type for the Mutation object which includes all mutation strategies.
 */
export interface MutationType {
  ADD_NODE: MutationInterface;
  SUB_NODE: MutationInterface;
  ADD_CONN: MutationInterface;
  SUB_CONN: MutationInterface;
  MOD_WEIGHT: MutationInterface;
  MOD_BIAS: MutationInterface;
  MOD_ACTIVATION: MutationInterface;
  ADD_SELF_CONN: MutationInterface;
  SUB_SELF_CONN: MutationInterface;
  ADD_BACK_CONN: MutationInterface;
  SUB_BACK_CONN: MutationInterface;
  SWAP_NODES: MutationInterface;
  FFW: readonly MutationInterface[];
  ALL: readonly MutationInterface[];
}
