/**
 * Helpers for working with the AI
 *
 * @module
 */

export { Creature } from "./src/Creature.ts";
export type {
  CreatureExport,
  CreatureTrace,
} from "./src/architecture/CreatureInterfaces.ts";
export { CreatureUtil } from "./src/architecture/CreatureUtils.ts";
export type { NeatOptions } from "./src/config/NeatOptions.ts";
export { Selection } from "./src/methods/Selection.ts";
export { Mutation } from "./src/methods/mutation.ts";
export { CRISPR } from "./src/reconstruct/CRISPR.ts";
export { Upgrade } from "./src/reconstruct/Upgrade.ts";
