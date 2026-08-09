/**
 * @module
 *
 * Decides which neurons take part in one sparse backpropagation iteration.
 *
 * Sparse training updates only a `sparseRatio` subset of neurons per iteration
 * instead of the whole creature. {@link SparseConfig} resolves that subset once
 * at construction — the chosen neurons, plus every neuron on a path from one of
 * them to an output — and then answers the three per-neuron questions the
 * propagation loop asks: does this neuron need tracing, propagating, or
 * updating? Neurons on a path must still propagate so gradient reaches the
 * chosen ones, but only the chosen ones have their weights updated.
 *
 * Selection is error-guided when per-neuron errors from the previous iteration
 * are supplied (Issue #1388), otherwise it is random. Build one config per
 * iteration; it is immutable once constructed.
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronStateInterface } from "@architecture/CreatureState.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { OutgoingSynapsesMap } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { calculatePathsToOutput } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { chooseNeurons } from "@propagate/sparse/ChooseNeurons.ts";
import type { SparseConfigLike } from "@propagate/sparse/SparseConfigLike.ts";

export class SparseConfig implements SparseConfigLike {
  private selectedNeurons: Readonly<Set<number>>;
  private paths: Readonly<Set<number>>;

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
    neuronErrors?: ReadonlyMap<number, NeuronStateInterface>,
  ) {
    this.selectedNeurons = chooseNeurons(creature, config, neuronErrors);
    this.paths = calculatePathsToOutput(
      this.selectedNeurons,
      creature,
      outgoingSynapsesMap,
    );
  }

  traceNeeded(id: number): boolean {
    return this.selectedNeurons.has(id);
  }

  propagateNeeded(id: number): boolean {
    return this.selectedNeurons.has(id) || this.paths.has(id);
  }

  updateNeeded(id: number): boolean {
    return this.selectedNeurons.has(id);
  }
}
