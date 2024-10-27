import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";
import { calculatePathsToOutput } from "./CalculatePathsToOutput.ts";
import { chooseNeurons } from "./ChooseNeurons.ts";
export class SparseConfig {
  private selectedNeurons: Readonly<Set<string>>;
  private paths: Readonly<Set<string>>;
  constructor(creature: CreatureExport, config: BackPropagationConfig) {
    this.selectedNeurons = chooseNeurons(creature, config);
    this.paths = calculatePathsToOutput(this.selectedNeurons, creature);
  }

  traceNeeded(uuid: string): boolean {
    return this.selectedNeurons.has(uuid);
  }

  propagateNeeded(uuid: string): boolean {
    return this.selectedNeurons.has(uuid) || this.paths.has(uuid);
  }

  updateNeeded(uuid: string): boolean {
    return this.selectedNeurons.has(uuid);
  }
}
