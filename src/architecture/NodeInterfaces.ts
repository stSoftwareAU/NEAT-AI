import { TagsInterface } from "../tags/TagsInterface.ts";
import { NodeState } from "./NetworkState.ts";
interface NodeAbstract extends TagsInterface {
  uuid?: string;
  bias?: number;
  squash?: string;
}
export interface NodeExport extends NodeAbstract {
  readonly type: "hidden" | "output" | "constant";
  uuid: string;
  bias: number;
  squash?: string;
}

export interface NodeInternal extends NodeAbstract {
  readonly type: "input" | "hidden" | "output" | "constant";
  index: number;
}

export interface NodeTrace extends NodeExport {
  trace: NodeState;
}
