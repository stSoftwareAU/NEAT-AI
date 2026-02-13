import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { NeuronStateInterface } from "../../architecture/CreatureState.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";
import type { OutgoingSynapsesMap } from "./CalculatePathsToOutput.ts";
import { calculatePathsToOutput } from "./CalculatePathsToOutput.ts";
import { chooseNeurons } from "./ChooseNeurons.ts";
import type { SparseConfigLike } from "./SparseConfigLike.ts";

export class SparseConfig implements SparseConfigLike {
  private selectedNeurons: Readonly<Set<string>>;
  private paths: Readonly<Set<string>>;

  /**
   * @param creature The creature topology to build sparse config for.
   * @param config Backpropagation config containing sparseRatio.
   * @param outgoingSynapsesMap Optional pre-built outgoing synapse map.
   *   When supplied, avoids rebuilding the O(synapses) map internally.
   *   Issue #1294: Path-to-output caching for sparse training.
   * @param neuronErrors Optional per-neuron error data from previous iteration.
   *   When supplied, error-guided neuron selection prioritises high-error neurons.
   *   Issue #1388: Error-guided sparse neuron selection.
   */
  constructor(
    creature: CreatureExport,
    config: BackPropagationConfig,
    outgoingSynapsesMap?: OutgoingSynapsesMap,
    neuronErrors?: ReadonlyMap<string, NeuronStateInterface>,
  ) {
    this.selectedNeurons = chooseNeurons(creature, config, neuronErrors);
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
