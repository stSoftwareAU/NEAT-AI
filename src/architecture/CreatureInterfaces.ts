import { TagsInterface } from "../tags/TagsInterface.ts";
import {
  ConnectionExport,
  ConnectionInternal,
  ConnectionTrace,
} from "./ConnectionInterfaces.ts";
import { NodeExport, NodeInternal, NodeTrace } from "./NodeInterfaces.ts";

interface CreatureCommon extends TagsInterface {
  /* ID of this network */
  input: number;
  output: number;
}

export interface CreatureInternal extends CreatureCommon {
  uuid?: string;
  connections: ConnectionInternal[];

  nodes: NodeInternal[];

  /** The error plus a discount because of the complexity of the genome */
  score?: number;
}

export interface CreatureExport extends CreatureCommon {
  connections: ConnectionExport[];

  nodes: NodeExport[];
}

export interface CreatureTrace extends CreatureExport {
  connections: ConnectionTrace[];

  nodes: NodeTrace[];
}
