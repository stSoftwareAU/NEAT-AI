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
  synapses: SynapseInternal[];

  neurons: NeuronInternal[];

  /** The error plus a discount because of the complexity of the genome */
  score?: number;
}

export interface CreatureExport extends CreatureCommon {
  synapses: SynapseExport[];

  neurons: NeuronExport[];
}

export interface CreatureTrace extends CreatureExport {
  synapses: SynapseTrace[];

  neurons: NeuronTrace[];
}
