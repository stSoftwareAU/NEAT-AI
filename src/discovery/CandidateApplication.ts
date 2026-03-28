/**
 * Candidate Application Module
 *
 * Handles applying discovery candidate changes to creatures and validating the results.
 * This includes forward-only enforcement, version bumping, UUID index mapping,
 * and the validate-then-fix strategy for creature modifications.
 *
 * Low-level apply operations extracted to CandidateApplicationOps.ts.
 *
 * Extracted from DiscoveryCandidates.ts as part of #1473.
 */

import {
  applyCoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import type { Creature } from "../Creature.ts";
import { exportJSON } from "../creature/CreatureSerialization.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import { getMajorVersion } from "../upgrade/Upgrade.ts";
import { getLogger } from "../utils/Logger.ts";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";
import {
  applyAddNeurons,
  applyAddSynapses,
  applyChangeSquash,
  applyRemoveNeuron,
  applyRemoveSynapse,
} from "./CandidateApplicationOps.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";

/**
 * Upgrade 2.x/3.x creatures to 4.x once forward-only validity is confirmed.
 *
 * Rationale: forward-only became a hard invariant in 4.x.
 * We should mark a creature as 4.x whenever we have just validated it as
 * forward-only, even if no repair was needed, so downstream logic treats
 * structurally identical creatures consistently.
 */
function bumpToFourIfForwardOnlyConfirmed(creature: Creature): void {
  const major = getMajorVersion(creature.semanticVersion);
  if (major === 2 || major === 3) {
    creature.semanticVersion = "4.0.0";
  }
}

/**
 * Determine whether forward-only must be enforced for this creature.
 *
 * - If `forwardOnly` is true, we must reject recurrent connections.
 * - If the creature is 4.x+, forward-only is a hard invariant.
 */
function shouldEnforceForwardOnly(creature: Creature): boolean {
  return creature.forwardOnly === true ||
    getMajorVersion(creature.semanticVersion) >= 4;
}

/**
 * Build a neuron ID -> neuron index mapping from an exported creature JSON.
 *
 * Note: `CreatureExport.neurons` excludes input neurons. Its ordering matches the
 * creature's internal indices, offset by `input`.
 */
export function buildIdToIndexMap(
  creatureJSON: { input: number; neurons: Array<{ id?: number }> },
): Map<number, number> {
  const idToIndex = new Map<number, number>();
  const inputCount = creatureJSON.input ?? 0;

  for (let i = 0; i < inputCount; i++) {
    idToIndex.set(i, i);
  }

  for (let i = 0; i < creatureJSON.neurons.length; i++) {
    idToIndex.set(creatureJSON.neurons[i].id!, inputCount + i);
  }

  return idToIndex;
}

/**
 * Safely validates a creature and handles validation errors.
 *
 * Strategy:
 * 1. Always call validate() first - this is the preferred path (no structural issues)
 * 2. If validate() fails, log details
 * 3. Only call fix() as a last resort - each fix() call indicates a bug that should be addressed
 *
 * @param creature The creature to validate
 * @param changeType The type of change being applied (for logging)
 * @returns The validated (and potentially fixed) creature
 */
export function validateAndFixCreatureSync(
  creature: Creature,
  changeType: DiscoveryChangeType,
): Creature {
  const enforceForwardOnly = shouldEnforceForwardOnly(creature);
  try {
    // Preferred path: validate first - if this passes, no fix() needed
    if (enforceForwardOnly) {
      creature.validate({ forwardOnly: true });
      creature.forwardOnly = true;
      bumpToFourIfForwardOnlyConfirmed(creature);
    } else {
      creature.validate();
    }
    return creature;
  } catch (error) {
    // Validation failed - this indicates our modification logic created an invalid creature
    const validationError = error instanceof ValidationError
      ? error
      : new ValidationError(
        `Unexpected error during validation: ${error}`,
        "OTHER",
      );

    // Log the validation failure with details
    getLogger().warn(
      `[DiscoveryCandidates] Validation failed for ${changeType} change: ${validationError.message}`,
    );
    getLogger().warn(
      `[DiscoveryCandidates] Cannot write debug file in synchronous context`,
    );

    // Last resort: call fix() to repair the creature
    getLogger().warn(
      `[DiscoveryCandidates] Calling fix() on ${changeType} change - this indicates a bug in modification logic that should be addressed`,
    );
    if (enforceForwardOnly) {
      creature.fix({ forwardOnly: true });
      creature.forwardOnly = true;
    } else {
      creature.fix();
    }

    // Validate again after fix() to ensure it's now valid
    try {
      if (enforceForwardOnly) {
        creature.validate({ forwardOnly: true });
        creature.forwardOnly = true;
        bumpToFourIfForwardOnlyConfirmed(creature);
      } else {
        creature.validate();
      }
    } catch (fixError) {
      getLogger().error(
        `[DiscoveryCandidates] Creature still invalid after fix() for ${changeType}: ${fixError}`,
      );
      throw fixError;
    }

    return creature;
  }
}

/**
 * Apply a candidate's change to a creature, returning the modified creature.
 *
 * @param creature The creature to apply the change to (may have prior modifications)
 * @param candidate The candidate containing the change to apply
 * @param baseCreature The original creature before any changes (used for removal detection)
 */
export function applyChangeToCreature(
  creature: Creature,
  candidate: DiscoveryCandidate,
  baseCreature: Creature,
): Creature | undefined {
  const changeType = candidate.change.type;
  const candidateJSON = exportJSON(candidate.creature);
  const creatureJSON = exportJSON(creature);
  const baseJSON = exportJSON(baseCreature);
  normaliseCreatureExport(candidateJSON);
  normaliseCreatureExport(creatureJSON);
  normaliseCreatureExport(baseJSON);
  const enforceForwardOnly = shouldEnforceForwardOnly(creature);
  const idToIndex = enforceForwardOnly
    ? buildIdToIndexMap(creatureJSON)
    : undefined;

  try {
    switch (changeType) {
      case "coordinated-structural": {
        const spec = candidate.change.coordinatedStructuralCandidate;
        if (!spec) return undefined;
        return applyCoordinatedStructuralCandidate(creature, spec);
      }

      case "add-synapses": {
        return applyAddSynapses(
          creatureJSON,
          candidateJSON,
          enforceForwardOnly,
          idToIndex,
        );
      }

      case "add-neurons": {
        return applyAddNeurons(
          creatureJSON,
          candidateJSON,
          enforceForwardOnly,
        );
      }

      case "change-squash": {
        return applyChangeSquash(
          creature,
          creatureJSON,
          candidateJSON,
          candidate,
        );
      }

      case "remove-synapse": {
        return applyRemoveSynapse(
          creatureJSON,
          candidateJSON,
          baseJSON,
          enforceForwardOnly,
          idToIndex,
        );
      }

      case "remove-neuron":
      case "remove-low-impact":
      case "cache-informed-removal": {
        return applyRemoveNeuron(
          creature,
          creatureJSON,
          candidateJSON,
          baseJSON,
          enforceForwardOnly,
          changeType,
        );
      }

      default:
        getLogger().warn(
          `[DiscoveryCandidates] Unknown change type for combination: ${changeType}`,
        );
        return undefined;
    }
  } catch (error) {
    getLogger().warn(
      `[DiscoveryCandidates] Failed to apply ${changeType} change during combination:`,
      error,
    );
    return undefined;
  }
}
