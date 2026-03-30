/**
 * Barrel re-export for discovery application operations.
 *
 * This module re-exports all discovery application functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export {
  recordDiscoveryIssue,
  validateAndFixIfNeeded,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryValidation.ts";

export {
  addHelpfulSynapses,
  removeSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverySynapseOps.ts";

export {
  addHelpfulNeurons,
  changeSquash,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronAddition.ts";

export {
  getRemovalSameUUIDCount,
  removeHarmfulNeuron,
  removeLowImpactNeuron,
  resetRemovalDiagnostics,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
