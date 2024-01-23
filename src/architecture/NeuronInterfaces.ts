import { TagsInterface } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { NeuronState } from "./CreatureState.ts";

interface NeuronAbstract extends TagsInterface {
  uuid?: string;
  bias?: number;
  squash?: string;
}

export interface NeuronExport extends NeuronAbstract {
  readonly type: "hidden" | "output" | "constant";
  uuid: string;
  bias: number;
  squash?: string;
}

export interface NeuronInternal extends NeuronAbstract {
  readonly type: "input" | "hidden" | "output" | "constant";
  index: number;
}

export interface NeuronTrace extends NeuronExport {
  trace: NeuronState;
}
