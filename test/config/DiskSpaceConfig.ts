/**
 * Tests for discovery disk space monitoring configuration.
 *
 * Issue #1703: Verifies that the DiskSpaceConfig is correctly parsed
 * by createNeatConfig with defaults and overrides, and that cross-field
 * validation catches invalid threshold combinations.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { parseDiskSpaceConfig } from "../../src/config/NeatConfigParsers.ts";

// ── Default values ──────────────────────────────────────────────────

Deno.test("DiskSpaceConfig defaults are applied when no overrides given", () => {
  const config = createNeatConfig({});
  assertEquals(config.discoveryDiskSpace.minFreeDiskMB, 500);
  assertEquals(config.discoveryDiskSpace.criticalFreeDiskMB, 100);
  assertEquals(config.discoveryDiskSpace.enabled, true);
});

// ── Custom overrides ────────────────────────────────────────────────

Deno.test("DiskSpaceConfig accepts custom thresholds", () => {
  const config = createNeatConfig({
    discoveryDiskSpace: {
      minFreeDiskMB: 1000,
      criticalFreeDiskMB: 200,
    },
  });
  assertEquals(config.discoveryDiskSpace.minFreeDiskMB, 1000);
  assertEquals(config.discoveryDiskSpace.criticalFreeDiskMB, 200);
  assertEquals(config.discoveryDiskSpace.enabled, true);
});

Deno.test("DiskSpaceConfig can be disabled", () => {
  const config = createNeatConfig({
    discoveryDiskSpace: {
      enabled: false,
    },
  });
  assertEquals(config.discoveryDiskSpace.enabled, false);
});

Deno.test("DiskSpaceConfig accepts string values from CLI", () => {
  const config = createNeatConfig({
    discoveryDiskSpace: {
      minFreeDiskMB: "750" as unknown as number,
      criticalFreeDiskMB: "150" as unknown as number,
    },
  });
  assertEquals(config.discoveryDiskSpace.minFreeDiskMB, 750);
  assertEquals(config.discoveryDiskSpace.criticalFreeDiskMB, 150);
});

// ── Cross-field validation ──────────────────────────────────────────

Deno.test("DiskSpaceConfig rejects criticalFreeDiskMB > minFreeDiskMB", () => {
  assertThrows(
    () =>
      createNeatConfig({
        discoveryDiskSpace: {
          minFreeDiskMB: 100,
          criticalFreeDiskMB: 200,
        },
      }),
    Error,
    "criticalFreeDiskMB must be <= minFreeDiskMB",
  );
});

Deno.test("DiskSpaceConfig allows equal thresholds", () => {
  const config = createNeatConfig({
    discoveryDiskSpace: {
      minFreeDiskMB: 300,
      criticalFreeDiskMB: 300,
    },
  });
  assertEquals(config.discoveryDiskSpace.minFreeDiskMB, 300);
  assertEquals(config.discoveryDiskSpace.criticalFreeDiskMB, 300);
});

// ── Parser unit tests ───────────────────────────────────────────────

Deno.test("parseDiskSpaceConfig applies defaults when no overrides", () => {
  const result = parseDiskSpaceConfig(undefined);
  assertEquals(result.minFreeDiskMB, 500);
  assertEquals(result.criticalFreeDiskMB, 100);
  assertEquals(result.enabled, true);
});

Deno.test("parseDiskSpaceConfig merges partial overrides", () => {
  const result = parseDiskSpaceConfig({ minFreeDiskMB: 800 });
  assertEquals(result.minFreeDiskMB, 800);
  assertEquals(result.criticalFreeDiskMB, 100);
  assertEquals(result.enabled, true);
});

Deno.test("parseDiskSpaceConfig allows zero thresholds", () => {
  const result = parseDiskSpaceConfig({
    minFreeDiskMB: 0,
    criticalFreeDiskMB: 0,
  });
  assertEquals(result.minFreeDiskMB, 0);
  assertEquals(result.criticalFreeDiskMB, 0);
});
