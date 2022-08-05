import { TagsInterface } from "../tags/TagsInterface.ts";

interface NodeJSON extends TagsInterface {
  bias?: number;
  type: string;
  squash?: string;
}

export interface NodeInterface {
  readonly type: "input" | "hidden" | "output" | "group" | "constant";
  index: number;
  bias?: number;
  toJSON(): NodeJSON;
}
