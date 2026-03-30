import { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { pruneOrphanMemeticReferences } from "../compact/CompactUtils.ts";
import { exportJSONWithRuntimeIds } from "../architecture/PopulateRuntimeIdsFromCreature.ts";
import type { ValidationError } from "../errors/ValidationError.ts";
import { writeDiagnostics } from "../utils/Diagnostics.ts";
import { getLogger } from "../utils/Logger.ts";
import { upgradeTwo } from "./UpgradeTwo.ts";

/**
 * The current major version.
 *
 * Version 4.x is the modern on-wire genome format. Forward-only vs feedback is
 * expressed by `Creature.forwardOnly`, not by staying on 2.x.
 */
export const SEMANTIC_MAJOR_VERSION = 4;

/**
 * Extracts the major version number from a semantic version string.
 * @param version - Semantic version string (e.g., "3.1.0", "2.0.0")
 * @returns The major version number, or 0 if invalid
 */
export function getMajorVersion(version: string | undefined): number {
  if (!version) return 0;
  const major = parseInt(version.split(".")[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Validates that a 3.x creature is still forward-only.
 * If the creature has recurrent connections, logs a warning but does NOT modify
 * the creature. Fixing should only happen on offspring, not on parents during
 * breeding.
 *
 * @param creature - The 3.x creature to validate
 */
function validateThreeX(creature: Creature): void {
  try {
    creatureValidate(creature, { forwardOnly: true });
  } catch (error) {
    // This should never happen - 3.x creatures should have been validated.
    // Log the error but don't modify the creature - offspring validation will
    // handle any issues during breeding.
    getLogger().error(
      `[upgrade] Version 3.x creature has invalid recurrent connections. ` +
        `This indicates a data integrity issue. UUID: ${creature.uuid}, Error: ${
          error instanceof Error ? error.message : error
        }`,
    );
  }
}

/**
 * Validates that a 4.x (or later) creature is still forward-only.
 *
 * For 4.x, forward-only is a hard invariant: any recurrent connection is an error,
 * regardless of whether the `forwardOnly` flag is set.
 *
 * If validation fails, we log diagnostics and **throw**, except for
 * `NO_INWARD_CONNECTIONS` and `NO_OUTWARD_CONNECTIONS` on forward-only creatures:
 * we run `creature.fix()` once (random inbound synapses, orphan/constant cleanup,
 * etc.) and retry — GRQ-12 class corrupt genomes after recurrent strip, and
 * stranded constants/hiddens with no outward edges. Other failures still throw
 * (Issue #2086).
 *
 * See https://github.com/stSoftwareAU/NEAT-AI/issues/956 for historical repair
 * behaviour and https://github.com/stSoftwareAU/NEAT-AI/issues/2086.
 */
function validateFourX(creature: Creature): void {
  // Breeding/memetics can leave weight rows pointing at removed neurons; prune
  // before validate so MEMETIC is not misclassified as an unrepaired bug (#2077).
  pruneOrphanMemeticReferences(creature);

  if (creature.forwardOnly === false) {
    try {
      creatureValidate(creature);
      return;
    } catch (e) {
      const error = e as ValidationError;
      getLogger().error(
        `[upgrade] CRITICAL: 4.x feedback-enabled creature failed validation: ` +
          `${error.name} - ${error.message}.`,
      );
      throw e;
    }
  }

  try {
    creatureValidate(creature, { forwardOnly: true });
    creature.forwardOnly = true;
    return;
  } catch (e) {
    const error = e as ValidationError;

    if (
      error.reason === "NO_INWARD_CONNECTIONS" ||
      error.reason === "NO_OUTWARD_CONNECTIONS"
    ) {
      try {
        creature.fix({ forwardOnly: true });
        creatureValidate(creature, { forwardOnly: true });
        creature.forwardOnly = true;
        return;
      } catch (e2) {
        const followUp = e2 as ValidationError;
        getLogger().error(
          `[upgrade] CRITICAL: 4.x creature (UUID: ${
            creature.uuid ?? "unknown"
          }) still invalid after NO_INWARD/NO_OUTWARD repair: ` +
            `${followUp.name} - ${followUp.message}.`,
        );
        writeDiagnostics({
          error: followUp,
          prefix: "upgrade-4x",
          creature: creature.exportJSON(),
          context: {
            semanticVersion: creature.semanticVersion,
            uuid: creature.uuid,
            forwardOnly: creature.forwardOnly,
            neuronCount: creature.neurons.length,
            synapseCount: creature.synapses.length,
            afterNoInwardOrOutwardRepair: true,
          },
        });
        throw followUp;
      }
    }

    getLogger().error(
      `[upgrade] CRITICAL: 4.x creature (UUID: ${
        creature.uuid ?? "unknown"
      }) failed forward-only validation: ` +
        `${error.name} - ${error.message}. ` +
        `This is a bug in our code that must be fixed (not the creature).`,
    );

    writeDiagnostics({
      error,
      prefix: "upgrade-4x",
      creature: creature.exportJSON(),
      context: {
        semanticVersion: creature.semanticVersion,
        uuid: creature.uuid,
        forwardOnly: creature.forwardOnly,
        neuronCount: creature.neurons.length,
        synapseCount: creature.synapses.length,
      },
    });

    throw e;
  }
}

/**
 * Attempts to upgrade a 2.x/3.x creature to 4.x once topology validates for the
 * current mode (forward-only vs feedback-enabled).
 */
function tryUpgradeToFour(creature: Creature): Creature {
  if (creature.forwardOnly === false) {
    try {
      pruneOrphanMemeticReferences(creature);
      creatureValidate(creature);
      creature.semanticVersion = "4.0.0";
    } catch (_error) {
      getLogger().warn(
        `[upgrade] Feedback-enabled creature failed validation before 4.x promotion`,
      );
    }
    return creature;
  }

  // forwardOnly === true - validate it's actually forward-only before upgrading
  if (creature.forwardOnly === true) {
    try {
      pruneOrphanMemeticReferences(creature);
      creatureValidate(creature, { forwardOnly: true });
      creature.semanticVersion = "4.0.0";
    } catch (_error) {
      // Do not call fix() here — same rationale as validateFourX (#2086 follow-up).
      getLogger().warn(
        `[upgrade] Creature claims forwardOnly but failed validation; clearing flag`,
      );
      creature.forwardOnly = undefined;
    }
    return creature;
  }

  // forwardOnly undefined - stay at 2.x until status is determined
  return creature;
}

/**
 * Prepare a shallow-cloned parent for breeding.
 *
 * All creatures are 4.x — the upgrade is a one-time load-from-disk operation.
 */
export function prepareCreatureForBreeding(creature: Creature): Creature {
  validateFourX(creature);
  return creature;
}

/**
 * Legacy upgrade pipeline — load-from-disk only.
 *
 * Upgrades a creature from pre-4.x formats to the current version. This should
 * only ever fire for very old files loaded from disk. In normal operation all
 * creatures are already 4.x and this function is a no-op.
 */
export function upgrade(creature: Creature): Creature {
  const majorVersion = getMajorVersion(creature.semanticVersion);

  // Already at version 4.x or higher - validate topology for the current mode.
  if (majorVersion >= 4) {
    validateFourX(creature);
    return creature;
  }

  // Version 3.x is legacy forward-only: warn-only if recurrent connections appear.
  if (majorVersion === 3) {
    validateThreeX(creature);
    return creature;
  }

  // At version 2.x - try to upgrade to 4.x if forwardOnly status is confirmed
  if (majorVersion === 2) {
    return tryUpgradeToFour(creature);
  }

  // Upgrade from 1.x → 2.x, then try 4.x
  if (majorVersion === 1) {
    const v2 = upgradeTwo(exportJSONWithRuntimeIds(creature));
    const upgraded = Creature.fromJSON(v2);
    return tryUpgradeToFour(upgraded);
  }

  // Version 0 or unknown - set to 1.0.0 first, then upgrade to 2.x, then try 4.x
  // This handles undefined versions, invalid formats, and "0.x" versions
  if (majorVersion === 0) {
    const json = exportJSONWithRuntimeIds(creature);
    json.semanticVersion = "1.0.0"; // Set to 1.0.0 so upgradeTwo can process it
    const v2 = upgradeTwo(json);
    const upgraded = Creature.fromJSON(v2);
    return tryUpgradeToFour(upgraded);
  }

  return creature;
}
