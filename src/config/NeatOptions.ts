import type { AdaptiveMutationThresholds } from "./AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { NeatArguments } from "./NeatArguments.ts";
import type { PlateauDetectionConfig } from "../NEAT/PlateauDetector.ts";

/**
 * Options for NEAT configuration.
 * All properties are optional; defaults are applied in createNeatConfig().
 * For discoveryMinCandidatesPerCategory, adaptiveMutationThresholds, and plateauDetection,
 * you can specify partial overrides and defaults will be merged in.
 */
export type NeatOptions =
  & Omit<
    Partial<NeatArguments>,
    | "discoveryMinCandidatesPerCategory"
    | "adaptiveMutationThresholds"
    | "plateauDetection"
  >
  & {
    /** Partial overrides for minimum candidates per category (defaults applied if not specified) */
    discoveryMinCandidatesPerCategory?: DiscoveryMinCandidatesPerCategory;
    /** Partial overrides for adaptive mutation thresholds (defaults applied if not specified) */
    adaptiveMutationThresholds?: AdaptiveMutationThresholds;
    /** Partial overrides for plateau detection configuration (defaults applied if not specified) */
    plateauDetection?: PlateauDetectionConfig;
  };
