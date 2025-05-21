import { Creature } from "../Creature.ts";
import { upgradeTwo } from "./UpgradeTwo.ts";

/** The current major version */
export const SEMANTIC_MAJOR_VERSION = 2;

export function upgrade(creature: Creature): Creature {
  if (creature.semanticVersion.startsWith("1.")) {
    const updated = upgradeTwo(creature.exportJSON());
    return Creature.fromJSON(updated);
  }

  return creature;
}
