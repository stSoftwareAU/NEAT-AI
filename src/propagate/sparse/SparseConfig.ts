import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";
import type { OutgoingSynapsesMap } from "./CalculatePathsToOutput.ts";
import { calculatePathsToOutput } from "./CalculatePathsToOutput.ts";
import { chooseNeurons } from "./ChooseNeurons.ts";

export class SparseConfig {
  private selectedNeurons: Readonly<Set<string>>;
  private paths: Readonly<Set<string>>;

  /**
   * @param creature The creature topology to build sparse config for.
   * @param config Backpropagation config containing sparseRatio.
   * @param outgoingSynapsesMap Optional pre-built outgoing synapse map.
   *   When supplied, avoids rebuilding the O(synapses) map internally.
   *   Issue #1294: Path-to-output caching for sparse training.
   */
  constructor(
    creature: CreatureExport,
    config: BackPropagationConfig,
    outgoingSynapsesMap?: OutgoingSynapsesMap,
  ) {
    this.selectedNeurons = chooseNeurons(creature, config);
    this.paths = calculatePathsToOutput(
      this.selectedNeurons,
      creature,
      outgoingSynapsesMap,
    );
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
