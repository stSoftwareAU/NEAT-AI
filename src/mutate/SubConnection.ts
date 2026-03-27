import {
  cleanupMemeticForRemovedSynapse,
  cleanupOrphanedNeurons,
} from "../compact/CompactUtils.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class SubConnection extends AbstractMutationOperator {
  /**
   * Subtract a connection from the network.
   */
  protected performMutation(focusList?: number[]): boolean {
    // Export the creature to JSON for clean manipulation
    // Use the builder directly to avoid validation (creature may be in an intermediate state)
    const builder = new CreatureExportBuilder(this.creature);
    const exportJSON = builder.build();
    normaliseCreatureExport(exportJSON);

    // List of possible connections that can be removed (forward connections only)
    const possible: { fromId: number; toId: number }[] = [];

    // Build neuron index map for focus checking
    const neuronIndexMap = new Map<number, number>();
    let idx = 0;
    // Input neurons first (implicit, not in export)
    for (let i = 0; i < this.creature.input; i++) {
      neuronIndexMap.set(i, idx++);
    }
    // Then exported neurons
    for (const neuron of exportJSON.neurons) {
      neuronIndexMap.set(neuron.id!, idx++);
    }

    // Build a set of IF neuron UUIDs and count their connection types,
    // so we don't remove a connection that would leave an IF neuron invalid.
    const ifNeuronIds = new Set<number>();
    for (const neuron of exportJSON.neurons) {
      if (neuron.squash === "IF") {
        ifNeuronIds.add(neuron.id!);
      }
    }

    // Count connection types per IF neuron
    const ifConnectionCounts = new Map<
      number,
      { condition: number; positive: number; negative: number }
    >();
    if (ifNeuronIds.size > 0) {
      for (const uuid of ifNeuronIds) {
        ifConnectionCounts.set(uuid, {
          condition: 0,
          positive: 0,
          negative: 0,
        });
      }
      for (const synapse of exportJSON.synapses) {
        const counts = ifConnectionCounts.get(synapse.toId!);
        if (counts) {
          const synapseType = synapse.type ?? "positive";
          if (synapseType === "condition") counts.condition++;
          else if (synapseType === "negative") counts.negative++;
          else counts.positive++;
        }
      }
    }

    for (const synapse of exportJSON.synapses) {
      const fromIdx = neuronIndexMap.get(synapse.fromId!);
      const toIdx = neuronIndexMap.get(synapse.toId!);

      // Only consider forward connections (to > from)
      if (fromIdx !== undefined && toIdx !== undefined && toIdx > fromIdx) {
        // Skip if removing this connection would break an IF neuron's invariants
        if (this.wouldBreakIfNeuron(synapse, ifConnectionCounts)) {
          continue;
        }

        // Check focus list using transitive focus checking
        // A neuron is in focus if it's directly in the focus list OR if any of
        // its upstream connected neurons are in focus
        const inFocus = this.creature.inFocus(fromIdx, focusList) ||
          this.creature.inFocus(toIdx, focusList);

        if (inFocus) {
          possible.push({ fromId: synapse.fromId!, toId: synapse.toId! });
        }
      }
    }

    if (possible.length === 0) {
      return false;
    }

    // Select a random connection to remove
    const randomConn = possible[
      Math.floor(getRandomNumberGenerator().random() * possible.length)
    ];

    // Remove the selected synapse
    exportJSON.synapses = exportJSON.synapses.filter(
      (s) => s.fromId !== randomConn.fromId || s.toId !== randomConn.toId,
    );

    // Clean up memetic data for the removed synapse
    cleanupMemeticForRemovedSynapse(
      exportJSON,
      randomConn.fromId,
      randomConn.toId,
    );

    // Clean up any neurons that have become orphaned after synapse removal.
    // This handles both:
    // - Converting hidden neurons with no inward connections to constants
    // - Removing hidden/constant neurons with no outward connections
    cleanupOrphanedNeurons(exportJSON);

    // Reload the creature from the modified export
    // Note: We pass false for validation to match the old in-place mutation behavior.
    // Validation is handled elsewhere (e.g., by the caller or by fix() if needed).
    this.creature.loadFrom(exportJSON, false);

    return true;
  }

  /** Check if removing a synapse would leave an IF neuron without required connections. */
  private wouldBreakIfNeuron(
    synapse: SynapseExport,
    ifConnectionCounts: Map<
      number,
      { condition: number; positive: number; negative: number }
    >,
  ): boolean {
    const counts = ifConnectionCounts.get(synapse.toId!);
    if (!counts) return false;

    const synapseType = synapse.type ?? "positive";
    if (synapseType === "condition" && counts.condition <= 1) return true;
    if (synapseType === "positive" && counts.positive <= 1) return true;
    if (synapseType === "negative" && counts.negative <= 1) return true;

    return false;
  }
}
