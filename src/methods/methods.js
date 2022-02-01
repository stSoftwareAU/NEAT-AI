/*******************************************************************************
                                  METHODS
*******************************************************************************/
import { Activation } from "./activation.js";
import { Mutation } from "./mutation.js";
import { Selection } from "./selection.js";
import { Crossover } from "./crossover.js";
import { Cost } from "./cost.js";
import { Gating } from "./gating.js";
import { Connection } from "./connection.js";
import { Rate } from "./rate.js";

export const Methods = {
  activation: Activation,
  mutation: Mutation,
  selection: Selection,
  crossover: Crossover,
  cost: Cost,
  gating: Gating,
  connection: Connection,
  rate: Rate,
};
