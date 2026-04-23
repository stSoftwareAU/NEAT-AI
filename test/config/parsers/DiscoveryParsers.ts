/**
 * Tests for DiscoveryParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_DISCOVERY_CACHE_CONFIG } from "@config/DiscoveryCacheConfig.ts";
import { DEFAULT_DISK_SPACE_CONFIG } from "@config/DiskSpaceConfig.ts";
import { DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY } from "@config/NeatConfig.ts";
import {
  parseDiscoveryCache,
  parseDiscoveryMinCandidates,
  parseDiskSpaceConfig,
} from "@config/parsers/DiscoveryParsers.ts";

Deno.test("parseDiscoveryMinCandidates - returns defaults when no overrides", () => {
  const cfg = parseDiscoveryMinCandidates(undefined);
  assertEquals(
    cfg.addNeurons,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addNeurons,
  );
  assertEquals(
    cfg.addSynapses,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addSynapses,
  );
  assertEquals(
    cfg.changeSquash,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.changeSquash,
  );
  assertEquals(
    cfg.removeLowImpact,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.removeLowImpact,
  );
});

Deno.test("parseDiscoveryMinCandidates - applies overrides", () => {
  const cfg = parseDiscoveryMinCandidates({ addNeurons: 7, addSynapses: 9 });
  assertEquals(cfg.addNeurons, 7);
  assertEquals(cfg.addSynapses, 9);
});

Deno.test("parseDiscoveryMinCandidates - rejects negative addNeurons", () => {
  assertThrows(
    () => parseDiscoveryMinCandidates({ addNeurons: -1 }),
    ConfigurationError,
  );
});

Deno.test("parseDiscoveryCache - returns defaults when no overrides", () => {
  const cfg = parseDiscoveryCache(undefined);
  assertEquals(
    cfg.successMaxEntries,
    DEFAULT_DISCOVERY_CACHE_CONFIG.successMaxEntries,
  );
  assertEquals(
    cfg.failureMaxEntries,
    DEFAULT_DISCOVERY_CACHE_CONFIG.failureMaxEntries,
  );
  assertEquals(cfg.ttlDays, DEFAULT_DISCOVERY_CACHE_CONFIG.ttlDays);
});

Deno.test("parseDiscoveryCache - applies partial overrides", () => {
  const cfg = parseDiscoveryCache({ successMaxEntries: 5000, ttlDays: 14 });
  assertEquals(cfg.successMaxEntries, 5000);
  assertEquals(cfg.ttlDays, 14);
});

Deno.test("parseDiscoveryCache - rejects ttlDays below 0.001", () => {
  assertThrows(
    () => parseDiscoveryCache({ ttlDays: 0 }),
    ConfigurationError,
  );
});

Deno.test("parseDiskSpaceConfig - returns defaults when no overrides", () => {
  const cfg = parseDiskSpaceConfig(undefined);
  assertEquals(cfg.enabled, DEFAULT_DISK_SPACE_CONFIG.enabled);
  assertEquals(cfg.minFreeDiskMB, DEFAULT_DISK_SPACE_CONFIG.minFreeDiskMB);
  assertEquals(
    cfg.criticalFreeDiskMB,
    DEFAULT_DISK_SPACE_CONFIG.criticalFreeDiskMB,
  );
});

Deno.test("parseDiskSpaceConfig - applies overrides", () => {
  const cfg = parseDiskSpaceConfig({
    enabled: !DEFAULT_DISK_SPACE_CONFIG.enabled,
    minFreeDiskMB: 1024,
  });
  assertEquals(cfg.enabled, !DEFAULT_DISK_SPACE_CONFIG.enabled);
  assertEquals(cfg.minFreeDiskMB, 1024);
});

Deno.test("parseDiskSpaceConfig - rejects negative minFreeDiskMB", () => {
  assertThrows(
    () => parseDiskSpaceConfig({ minFreeDiskMB: -1 }),
    ConfigurationError,
  );
});
