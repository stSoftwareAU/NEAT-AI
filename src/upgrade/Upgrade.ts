import { Creature } from "../Creature.ts";
import { upgradeThree } from "./UpgradeThree.ts";
import { upgradeTwo } from "./UpgradeTwo.ts";

/** The current major version */
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

export function upgrade(creature: Creature): Creature {
  const majorVersion = getMajorVersion(creature.semanticVersion);

  // Already at or beyond current major version - no upgrade needed
  if (majorVersion >= SEMANTIC_MAJOR_VERSION) {
    return creature;
  }

  // Upgrade from 1.x → 2.x → 3.x
  if (majorVersion === 1) {
    const v2 = upgradeTwo(creature.exportJSON());
    const v3 = upgradeThree(v2);
    return Creature.fromJSON(v3);
  }

  // Upgrade from 2.x → 3.x
  if (majorVersion === 2) {
    const v3 = upgradeThree(creature.exportJSON());
    return Creature.fromJSON(v3);
  }

  // Version 0 or unknown - treat as needing full upgrade path
  if (majorVersion === 0) {
    const v2 = upgradeTwo(creature.exportJSON());
    const v3 = upgradeThree(v2);
    return Creature.fromJSON(v3);
  }

  return creature;
}
