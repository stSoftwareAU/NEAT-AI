import { TagsInterface } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { NodeState } from "./CreatureState.ts";

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
