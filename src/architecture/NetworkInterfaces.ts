import { TagsInterface } from "../tags/TagsInterface.ts";
import {
  ConnectionExport,
  ConnectionInternal,
  ConnectionTrace,
} from "./ConnectionInterfaces.ts";
import { NodeExport, NodeInternal } from "./NodeInterfaces.ts";

interface NetworkCommon extends TagsInterface {
  /* ID of this network */
  input: number;
  output: number;
}

export interface NetworkInternal extends NetworkCommon {
  uuid?: string;
  connections: ConnectionInternal[];

  nodes: NodeInternal[];

  /** The error plus a discount because of the complexity of the genome */
  score?: number;
}

export interface NetworkExport extends NetworkCommon {
  connections: ConnectionExport[];

  nodes: NodeExport[];
}

export interface NetworkTrace extends NetworkExport {
  connections: ConnectionTrace[];

  nodes: NodeExport[];
}
