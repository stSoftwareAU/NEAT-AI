import { TagsInterface } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./SynapseInterfaces.ts";
import {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "./NeuronInterfaces.ts";

interface CreatureCommon extends TagsInterface {
  /* ID of this creature */
  input: number;
  output: number;
}

export interface CreatureInternal extends CreatureCommon {
  uuid?: string;
  connections: SynapseInternal[];

  nodes: NeuronInternal[];

  /** The error plus a discount because of the complexity of the genome */
  score?: number;
}

export interface CreatureExport extends CreatureCommon {
  connections: SynapseExport[];

  nodes: NeuronExport[];
}

export interface CreatureTrace extends CreatureExport {
  connections: SynapseTrace[];

  nodes: NeuronTrace[];
}
