/**
 * @module
 *
 * Contract for activations that operate over a whole `Neuron` rather than a
 * single scalar: forward activation with tracing, error back-propagation, and
 * Discovery recording. Aggregate-style activations implement this instead of
 * the scalar `ActivationInterface` because they need the neuron's incoming
 * connections and state.
 */

import type { DiscoverRecord } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { Neuron } from "@architecture/Neuron.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

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
    discoverMap: Map<number, DiscoverRecord>,
  ): void;
}
