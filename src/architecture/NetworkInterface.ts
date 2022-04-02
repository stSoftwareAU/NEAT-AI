import { TagsInterface } from "../tags/TagsInterface.ts";

export interface NetworkInterface extends TagsInterface {
  input: number;
  output: number;
  dropout: number;
  score?: number;

  nodes: {
    index: number;
    mask: number;
    bias: number;
    type: string;
    squash: string;
  }[];

  connections: {
    from: number;
    to: number;
    weight: number;
    gater: (null | number);
  }[];

  // deno-lint-ignore no-explicit-any
  gates?: any[];

  // deno-lint-ignore no-explicit-any
  selfconns?: any[];

  // deno-lint-ignore ban-types
  toJSON: Function;
  // deno-lint-ignore ban-types
  clear?: Function;
  // deno-lint-ignore ban-types
  noTraceActivate?: Function;
}
