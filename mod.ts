/**
 * Helpers for working with the AI
 *
 * @module
 */

export { Network } from "./src/architecture/Network.ts";
export type { NetworkExport, NetworkInternal, NetworkTrace } from "./src/architecture/NetworkInterfaces.ts";
export { NetworkUtil } from "./src/architecture/NetworkUtils.ts";
export type { NeatOptions } from "./src/config/NeatOptions.ts";
export { Selection } from "./src/methods/Selection.ts";
export { Mutation } from "./src/methods/mutation.ts";
export { CRISPR } from "./src/reconstruct/CRISPR.ts";
export { Upgrade } from "./src/reconstruct/Upgrade.ts";

export {
    addTag,
    getTag,
    removeTag
} from "./src/tags/TagsInterface.ts";
