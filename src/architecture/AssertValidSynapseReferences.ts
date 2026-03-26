/**
 * Validates that every synapse in a CreatureExport references neurons
 * that actually exist.
 *
 * This is a debugging and integrity tool for catching dangling neuron
 * references introduced by compact, discovery, or mutation operations.
 *
 * @module AssertValidSynapseReferences
 */

import type { CreatureExport } from "./CreatureInterfaces.ts";

/**
 * Asserts that every synapse in the CreatureExport references neurons that
 * exist. Checks both `fromId` and `toId` against the neurons array and valid
 * input neuron IDs (0 to inputCount-1).
 *
 * Throws with diagnostic information if a dangling reference is found.
 *
 * @param creatureExport - The creature export to validate
 * @param context - Optional context string included in error messages
 *   to help identify which operation produced the invalid state
 */
export function assertValidSynapseReferences(
  creatureExport: CreatureExport,
  context?: string,
): void {
  const validIds = new Set<number>();

  // Input neuron IDs: 0 to inputCount-1
  for (let i = 0; i < creatureExport.input; i++) {
    validIds.add(i);
  }

  // Neuron IDs from the neurons array
  for (const neuron of creatureExport.neurons) {
    if (neuron.id !== undefined) {
      validIds.add(neuron.id);
    }
  }

  const prefix = context ? `[${context}] ` : "";

  for (const synapse of creatureExport.synapses) {
    if (synapse.fromId !== undefined && !validIds.has(synapse.fromId)) {
      throw new Error(
        `${prefix}Dangling synapse fromId: ${synapse.fromId} does not ` +
          `reference a valid neuron. Synapse: ${JSON.stringify(synapse)}. ` +
          `Valid neuron IDs: [${
            [...validIds].sort((a, b) => a - b).join(", ")
          }]`,
      );
    }

    if (synapse.toId !== undefined && !validIds.has(synapse.toId)) {
      throw new Error(
        `${prefix}Dangling synapse toId: ${synapse.toId} does not ` +
          `reference a valid neuron. Synapse: ${JSON.stringify(synapse)}. ` +
          `Valid neuron IDs: [${
            [...validIds].sort((a, b) => a - b).join(", ")
          }]`,
      );
    }
  }
}
