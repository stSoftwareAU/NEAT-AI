import type { CreatureExport } from "../CreatureInterfaces.ts";
import type { CandidateSynapse } from "./DiscoverStructure.ts";

export interface DiscoverResult {
  ID: string;
  enhanced: CreatureExport | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;
}
