/**
 * Helpers for working with the AI
 *
 * @module
 */

// export * from "./src/Neat.ts";
// export * from "./src/Costs.ts";
// export * from "./src/config/NeatOptions.ts";
export * from "./src/architecture/Network.ts";
export type { NeatOptions } from "./src/config/NeatOptions.ts";
export { NetworkUtil } from "./src/architecture/NetworkUtils.ts";

export {CRISPR} from "./src/reconstruct/CRISPR.ts";
export {Selection} from "./src/methods/Selection.ts";
export {Mutation} from "./src/methods/mutation.ts";

export {
    addTag,
    getTag,
    removeTag,
  } from "./src/tags/TagsInterface.ts";