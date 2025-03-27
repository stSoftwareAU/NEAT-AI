import type { DiscoverRecord } from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "../../architecture/Neuron.ts";
import type { BackPropagationConfig } from "../../propagate/BackPropagation.ts";
import type { SparseConfig } from "../../propagate/sparse/SparseConfig.ts";
import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

export interface NeuronActivationInterface extends AbstractActivationInterface {
  activateAndTrace(neuron: Neuron): number;
  activate(neuron: Neuron): number;
  propagate(
    neuron: Neuron,
    targetActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number;

  record(
    neuron: Neuron,
    requestedActivation: number,
    discoverMap: Map<string, DiscoverRecord>,
  ): void;
}
