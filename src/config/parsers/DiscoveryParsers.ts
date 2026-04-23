/**
 * DiscoveryParsers.ts - Sub-config parsers for discovery features.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for the
 * discovery candidate categorisation, discovery cache eviction, and
 * disk-space monitoring around the discovery cache directory.
 */

import {
  DEFAULT_DISCOVERY_CACHE_CONFIG,
  type RequiredDiscoveryCacheConfig,
} from "@config/DiscoveryCacheConfig.ts";
import type { DiscoveryMinCandidatesPerCategory } from "@config/DiscoveryMinCandidatesPerCategory.ts";
import {
  DEFAULT_DISK_SPACE_CONFIG,
  type RequiredDiskSpaceConfig,
} from "@config/DiskSpaceConfig.ts";
import { DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY } from "@config/NeatConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";

/** Parse discovery minimum candidates per category. */
export function parseDiscoveryMinCandidates(
  overrides: Record<string, unknown> | undefined,
): Required<DiscoveryMinCandidatesPerCategory> {
  const d = DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY;
  return {
    addNeurons: parseNumber(
      "Discovery min candidates addNeurons",
      overrides?.addNeurons,
      d.addNeurons,
      { integer: true, min: 0 },
    ),
    addSynapses: parseNumber(
      "Discovery min candidates addSynapses",
      overrides?.addSynapses,
      d.addSynapses,
      { integer: true, min: 0 },
    ),
    changeSquash: parseNumber(
      "Discovery min candidates changeSquash",
      overrides?.changeSquash,
      d.changeSquash,
      { integer: true, min: 0 },
    ),
    removeLowImpact: parseNumber(
      "Discovery min candidates removeLowImpact",
      overrides?.removeLowImpact,
      d.removeLowImpact,
      { integer: true, min: 0 },
    ),
  } as Required<DiscoveryMinCandidatesPerCategory>;
}

/** Parse discovery cache eviction configuration (Issue #1701). */
export function parseDiscoveryCache(
  overrides: Record<string, unknown> | undefined,
): RequiredDiscoveryCacheConfig {
  const d = DEFAULT_DISCOVERY_CACHE_CONFIG;
  return {
    successMaxEntries: parseNumber(
      "Discovery cache successMaxEntries",
      overrides?.successMaxEntries,
      d.successMaxEntries,
      { integer: true, min: 1 },
    ),
    failureMaxEntries: parseNumber(
      "Discovery cache failureMaxEntries",
      overrides?.failureMaxEntries,
      d.failureMaxEntries,
      { integer: true, min: 1 },
    ),
    ttlDays: parseNumber(
      "Discovery cache ttlDays",
      overrides?.ttlDays,
      d.ttlDays,
      { min: 0.001 },
    ),
    obsoleteTTLDays: parseNumber(
      "Discovery cache obsoleteTTLDays",
      overrides?.obsoleteTTLDays,
      d.obsoleteTTLDays,
      { min: 0.001 },
    ),
  } as RequiredDiscoveryCacheConfig;
}

/** Parse discovery disk space monitoring configuration (Issue #1703). */
export function parseDiskSpaceConfig(
  overrides: Record<string, unknown> | undefined,
): RequiredDiskSpaceConfig {
  const d = DEFAULT_DISK_SPACE_CONFIG;
  return {
    enabled: overrides?.enabled !== undefined
      ? Boolean(overrides.enabled)
      : d.enabled,
    minFreeDiskMB: parseNumber(
      "Disk space minFreeDiskMB",
      overrides?.minFreeDiskMB,
      d.minFreeDiskMB,
      { min: 0 },
    ),
    criticalFreeDiskMB: parseNumber(
      "Disk space criticalFreeDiskMB",
      overrides?.criticalFreeDiskMB,
      d.criticalFreeDiskMB,
      { min: 0 },
    ),
  } as RequiredDiskSpaceConfig;
}
