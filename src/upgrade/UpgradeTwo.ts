import { assert } from "@std/assert/assert";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";

export function upgradeTwo(json: CreatureInternal | CreatureExport) {
  assert(
    json.semanticVersion && json.semanticVersion.startsWith("1."),
    `Already upgraded ${json.semanticVersion}`,
  );

  // If it doesn't, add the semanticVersion property and return the updated object
  return {
    ...json,
    semanticVersion: "2.0.0",
  };
}
