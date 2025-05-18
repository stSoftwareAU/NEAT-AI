import { assert } from "@std/assert/assert";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";

export function upgradeOne(json: CreatureInternal | CreatureExport) {
  assert(
    !json.semanticVersion || !json.semanticVersion.startsWith("1."),
    `Already upgraded version ${json.semanticVersion}`,
  );

  // If it doesn't, add the semanticVersion property and return the updated object
  return {
    ...json,
    semanticVersion: "1.0.0",
  };
}
