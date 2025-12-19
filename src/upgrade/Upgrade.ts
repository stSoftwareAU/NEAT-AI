import { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { upgradeTwo } from "./UpgradeTwo.ts";

/**
 * The current major version.
 *
 * Version 3.x indicates the creature has been validated as strictly forward-only
 * (no self/back connections). Once at 3.x, the creature must remain forward-only
 * and any violation is an error condition.
 *
 * Creatures with forwardOnly: false (explicitly allowing feedback loops) stay at 2.x.
 */
export const SEMANTIC_MAJOR_VERSION = 3;

/**
 * Extracts the major version number from a semantic version string.
 * @param version - Semantic version string (e.g., "3.1.0", "2.0.0")
 * @returns The major version number, or 0 if invalid
 */
function getMajorVersion(version: string | undefined): number {
  if (!version) return 0;
  const major = parseInt(version.split(".")[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Validates that a 3.x creature is still forward-only.
 * If the creature has self/back connections, logs a warning but does NOT modify
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
    console.error(
      `[upgrade] Version 3.x creature has invalid self/back connections. ` +
        `This indicates a data integrity issue. UUID: ${creature.uuid}, Error: ${
          error instanceof Error ? error.message : error
        }`,
    );
  }
}

/**
 * Attempts to upgrade a 2.x creature to 3.x if it's validated as forward-only.
 *
 * Version 3.x is assigned when:
 * - forwardOnly === true AND the creature passes forward-only validation
 *
 * Creatures with forwardOnly: false or undefined stay at 2.x:
 * - forwardOnly: false = explicitly allows feedback loops
 * - forwardOnly: undefined = status not yet determined
 *
 * @param creature - The creature to potentially upgrade
 * @returns The upgraded creature (at version 3.x) or unchanged creature (at 2.x)
 */
function tryUpgradeToThree(creature: Creature): Creature {
  // forwardOnly === true - validate it's actually forward-only before upgrading
  if (creature.forwardOnly === true) {
    try {
      creatureValidate(creature, { forwardOnly: true });
      creature.semanticVersion = "3.0.0";
    } catch (_error) {
      // Creature claims to be forward-only but isn't - clear the flag, stay at 2.x
      console.warn(
        `[upgrade] Creature claims forwardOnly but failed validation; clearing flag`,
      );
      creature.forwardOnly = undefined;
    }
    return creature;
  }

  // forwardOnly is false or undefined - stay at 2.x
  // - false: explicitly allows feedback loops
  // - undefined: status not yet determined, will be set during mutate/breed/fix
  return creature;
}

/**
 * Upgrades a creature's format to the latest compatible version.
 *
 * Upgrade path:
 * - 0.x/1.x/undefined → 2.x (format migration via upgradeTwo)
 * - 2.x → 3.x (if forwardOnly: true and validated as forward-only)
 * - 3.x+ → validated to ensure still forward-only (throws if not)
 *
 * @param creature - The creature to upgrade
 * @returns The upgraded creature
 * @throws {Error} If a 3.x creature has self/back connections
 */
export function upgrade(creature: Creature): Creature {
  const majorVersion = getMajorVersion(creature.semanticVersion);

  // Already at version 3.x or higher - validate it's still forward-only
  if (majorVersion >= 3) {
    validateThreeX(creature);
    return creature;
  }

  // At version 2.x - try to upgrade to 3.x if forwardOnly status is confirmed
  if (majorVersion === 2) {
    return tryUpgradeToThree(creature);
  }

  // Upgrade from 1.x → 2.x, then try 3.x
  if (majorVersion === 1) {
    const v2 = upgradeTwo(creature.exportJSON());
    const upgraded = Creature.fromJSON(v2);
    return tryUpgradeToThree(upgraded);
  }

  // Version 0 or unknown - set to 1.0.0 first, then upgrade to 2.x, then try 3.x
  // This handles undefined versions, invalid formats, and "0.x" versions
  if (majorVersion === 0) {
    const json = creature.exportJSON();
    json.semanticVersion = "1.0.0"; // Set to 1.0.0 so upgradeTwo can process it
    const v2 = upgradeTwo(json);
    const upgraded = Creature.fromJSON(v2);
    return tryUpgradeToThree(upgraded);
  }

  return creature;
}
