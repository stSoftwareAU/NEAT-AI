/**
 * Tests for DiscoveryCacheConfig parsing (Issue #1701).
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_DISCOVERY_CACHE_CONFIG } from "../../src/config/DiscoveryCacheConfig.ts";
import { parseDiscoveryCache } from "../../src/config/NeatConfigParsers.ts";

Deno.test("parseDiscoveryCache returns defaults when no overrides", () => {
  const config = parseDiscoveryCache(undefined);
  assertEquals(
    config.successMaxEntries,
    DEFAULT_DISCOVERY_CACHE_CONFIG.successMaxEntries,
  );
  assertEquals(
    config.failureMaxEntries,
    DEFAULT_DISCOVERY_CACHE_CONFIG.failureMaxEntries,
  );
  assertEquals(config.ttlDays, DEFAULT_DISCOVERY_CACHE_CONFIG.ttlDays);
  assertEquals(
    config.obsoleteTTLDays,
    DEFAULT_DISCOVERY_CACHE_CONFIG.obsoleteTTLDays,
  );
});

Deno.test("parseDiscoveryCache applies partial overrides", () => {
  const config = parseDiscoveryCache({
    successMaxEntries: 5000,
    ttlDays: 14,
  });
  assertEquals(config.successMaxEntries, 5000);
  assertEquals(
    config.failureMaxEntries,
    DEFAULT_DISCOVERY_CACHE_CONFIG.failureMaxEntries,
  );
  assertEquals(config.ttlDays, 14);
  assertEquals(
    config.obsoleteTTLDays,
    DEFAULT_DISCOVERY_CACHE_CONFIG.obsoleteTTLDays,
  );
});

Deno.test("parseDiscoveryCache accepts string values from CLI", () => {
  const config = parseDiscoveryCache({
    successMaxEntries: "2000",
    failureMaxEntries: "10000",
    ttlDays: "7",
    obsoleteTTLDays: "3",
  });
  assertEquals(config.successMaxEntries, 2000);
  assertEquals(config.failureMaxEntries, 10000);
  assertEquals(config.ttlDays, 7);
  assertEquals(config.obsoleteTTLDays, 3);
});
