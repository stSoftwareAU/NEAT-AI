import { TagsInterface } from "../tags/TagsInterface.ts";
import {
  ConnectionExport,
  ConnectionInternal,
} from "./ConnectionInterfaces.ts";
import { NodeExport, NodeInternal } from "./NodeInterfaces.ts";

interface NetworkCommon extends TagsInterface {
  /* ID of this network */
  uuid?: string;
  input: number;
  output: number;

  /** The error plus a discount because of the complexity of the genome */
  score?: number;
}

export interface NetworkInternal extends NetworkCommon {
  connections: ConnectionInternal[];

  nodes: NodeInternal[];
}

export interface NetworkExport extends NetworkCommon {
  connections: ConnectionExport[];

  nodes: NodeExport[];
}
