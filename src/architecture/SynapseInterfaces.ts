import { SynapseState } from "./CreatureState.ts";

interface SynapseCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";
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
