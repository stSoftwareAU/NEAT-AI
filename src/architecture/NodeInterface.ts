import { TagsInterface } from "../tags/TagsInterface.ts";

interface NodeJSON extends TagsInterface {
  bias?: number;
  type: string;
  squash: string;
}

export interface NodeInterface {
  readonly type: string;
  index: number;
  toJSON(): NodeJSON;
}
