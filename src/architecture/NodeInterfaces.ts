import { TagsInterface } from "../tags/TagsInterface.ts";

export interface NodeExport extends TagsInterface {
  readonly type: "input" | "hidden" | "output" | "constant";
  uuid?: string;
  bias?: number;
  squash?: string;
}

export interface NodeInternal extends NodeExport {
  index: number;
}

export interface NodeTrace extends NodeExport {
  trace: {
    // errorResponsibility?: number;
    // errorProjected?: number;
    // batchSize?: number;
    totalValue?: number;

    totalWeightedSum?: number;
  };
}
