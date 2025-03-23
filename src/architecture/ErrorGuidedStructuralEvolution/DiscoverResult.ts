import type { CreatureExport } from "../CreatureInterfaces.ts";

export interface DiscoverResult {
  ID: string;
  enhanced: CreatureExport | undefined;
}
