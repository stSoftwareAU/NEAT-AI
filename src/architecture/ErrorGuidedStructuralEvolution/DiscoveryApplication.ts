/**
 * Barrel re-export for discovery application operations.
 *
 * This module re-exports all discovery application functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export {
  recordDiscoveryIssue,
  validateAndFixIfNeeded,
} from "./DiscoveryValidation.ts";

export { addHelpfulSynapses, removeSynapse } from "./DiscoverySynapseOps.ts";

export { addHelpfulNeurons, changeSquash } from "./DiscoveryNeuronAddition.ts";

export {
  getRemovalSameUUIDCount,
  removeHarmfulNeuron,
  removeLowImpactNeuron,
  resetRemovalDiagnostics,
} from "./DiscoveryNeuronRemoval.ts";
