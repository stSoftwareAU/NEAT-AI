/*******************************************************************************
                                      MUTATION
*******************************************************************************/
export interface MutationInterface {
  name: string;
}
// https://en.wikipedia.org/wiki/mutation_(genetic_algorithm)
const temp = {
  ADD_NODE: {
    name: "ADD_NODE",
  },
  SUB_NODE: {
    name: "SUB_NODE",
  },
  ADD_CONN: {
    name: "ADD_CONN",
  },
  SUB_CONN: {
    name: "SUB_CONN",
  },
  MOD_WEIGHT: {
    name: "MOD_WEIGHT",
  },
  MOD_BIAS: {
    name: "MOD_BIAS",
  },
  MOD_ACTIVATION: {
    name: "MOD_ACTIVATION",
  },
  ADD_SELF_CONN: {
    name: "ADD_SELF_CONN",
  },
  SUB_SELF_CONN: {
    name: "SUB_SELF_CONN",
  },
  ADD_BACK_CONN: {
    name: "ADD_BACK_CONN",
  },
  SUB_BACK_CONN: {
    name: "SUB_BACK_CONN",
  },
  SWAP_NODES: {
    name: "SWAP_NODES",
    // mutateOutput: true,
  },
};

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
