import type { TagInterface } from "@stsoftware/tags";
import type { SynapseState } from "../propagate/SynapseState.ts";

interface SynapseCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";

  tags?: TagInterface[];
}

export interface SynapseInternal extends SynapseCommon {
  from: number;
  to: number;
}

export interface SynapseExport extends SynapseCommon {
  fromUUID: string;
  toUUID: string;
}

export interface SynapseTrace extends SynapseExport {
  trace: SynapseState;
}
