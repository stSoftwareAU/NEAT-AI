import { TagsInterface } from "../tags/TagsInterface.ts";

export interface NodeInterface extends TagsInterface {
  readonly type: "input" | "hidden" | "output" | "constant";
  uuid?: string;
  index: number;
  bias?: number;
  squash?: string;
}
