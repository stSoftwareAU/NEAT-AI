import { TagsInterface } from "../tags/TagsInterface.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";

export interface NetworkInterface extends TagsInterface {
  input: number;
  output: number;

  /** The error plus a discount because of the complexity of the genome */
  score?: number;

  nodes: NodeInterface[];

  connections: ConnectionInterface[];

  // deno-lint-ignore no-explicit-any
  // gates?: any[];x

  // deno-lint-ignore no-explicit-any
  // selfconns?: any[];

  // deno-lint-ignore ban-types
  toJSON: Function;
  // deno-lint-ignore ban-types
  clear?: Function;
  // deno-lint-ignore ban-types
  _trainSet?: Function;
  // deno-lint-ignore ban-types
  noTraceActivate?: Function;
  // deno-lint-ignore ban-types
  activate?: Function;
  // deno-lint-ignore ban-types
  mutate?: Function;
}
