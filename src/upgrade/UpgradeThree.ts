import { assert } from "@std/assert";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";

/**
 * Upgrades a creature from version 2.x to version 3.0.0.
 * Version 3.0.0 introduces forward-only validation requirements.
 *
 * @param json - The creature data to upgrade (either internal or export format)
 * @returns The upgraded creature data with semantic version 3.0.0
 * @throws {Error} When the creature is not at version 2.x
 */
export function upgradeThree(
  json: CreatureInternal | CreatureExport,
): CreatureInternal | CreatureExport {
  assert(
    json.semanticVersion && json.semanticVersion.startsWith("2."),
    `Expected version 2.x but got ${json.semanticVersion}`,
  );

  return {
    ...json,
    semanticVersion: "3.0.0",
  };
}
