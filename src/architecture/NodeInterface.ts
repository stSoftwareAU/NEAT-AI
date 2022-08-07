import { TagsInterface } from "../tags/TagsInterface.ts";

// interface NodeJSON extends TagsInterface {
//   bias?: number;
//   type: string;
//   squash?: string;
// }

export interface NodeInterface extends TagsInterface {
  readonly type: "input" | "hidden" | "output" | "constant";
  index: number;
  bias?: number;
  squash?: string;
}
