import { TagsInterface } from "../tags/TagsInterface.ts";
import { ConnectionExport, ConnectionInterface } from "./ConnectionInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";

interface NetworkCommon extends TagsInterface {
  /* ID of this network */
  uuid?: string;
  input: number;
  output: number;

  /** The error plus a discount because of the complexity of the genome */
  score?: number;

  nodes: NodeInterface[];
}

export interface NetworkInterface extends NetworkCommon {

  connections: ConnectionInterface[];
}

export interface NetworkExport extends NetworkCommon {

  connections: ConnectionExport[];
}
