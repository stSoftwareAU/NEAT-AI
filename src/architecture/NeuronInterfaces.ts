import type { TagsInterface } from "@stsoftware/tags/mod";
import type { NeuronStateInterface } from "./CreatureState.ts";

interface NeuronAbstract extends TagsInterface {
  uuid?: string;
  bias?: number;
  squash?: string;
}

export interface NeuronExport extends NeuronAbstract {
  readonly type: "hidden" | "output" | "constant";
  readonly uuid: string;
  bias: number;
  squash?: string;
}

export interface NeuronInternal extends NeuronAbstract {
  readonly type: "input" | "hidden" | "output" | "constant";
  index: number;
}

export interface NeuronTrace extends NeuronExport {
  trace: NeuronStateInterface;
}
