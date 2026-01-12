import type { AdaptiveMutationThresholds } from "./AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { NeatArguments } from "./NeatArguments.ts";

/**
 * Options for NEAT configuration.
 * All properties are optional; defaults are applied in createNeatConfig().
 * For discoveryMinCandidatesPerCategory and adaptiveMutationThresholds,
 * you can specify partial overrides and defaults will be merged in.
 */
export type NeatOptions =
  & Omit<
    Partial<NeatArguments>,
    "discoveryMinCandidatesPerCategory" | "adaptiveMutationThresholds"
  >
  & {
    /** Partial overrides for minimum candidates per category (defaults applied if not specified) */
    discoveryMinCandidatesPerCategory?: DiscoveryMinCandidatesPerCategory;
    /** Partial overrides for adaptive mutation thresholds (defaults applied if not specified) */
    adaptiveMutationThresholds?: AdaptiveMutationThresholds;
  };
