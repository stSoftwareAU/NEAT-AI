import { TagsInterface } from "../tags/TagsInterface.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";

export interface NetworkInterface extends TagsInterface {
  /* ID of this network */
  uuid?: string;
  input: number;
  output: number;

  /** The error plus a discount because of the complexity of the genome */
  score?: number;

  nodes: NodeInterface[];

  connections: ConnectionInterface[];
}
