import { assertEquals, assertExists } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

/**
 * Tests for discoveryCacheDir option in NeatOptions (Issue #997).
 *
 * The discoveryCacheDir option enables:
 * 1. Specifying a directory for discovery caching
 * 2. Automatic background replay of discoveries against new fittest creatures
 * 3. Passing the cache directory to the discovery process
 */

Deno.test("NeatConfig discoveryCacheDir - not set by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.discoveryCacheDir, undefined);
});

Deno.test("NeatConfig discoveryCacheDir - accepts valid directory path", () => {
  const config = createNeatConfig({
    discoveryCacheDir: "/tmp/discovery-cache",
  });
  assertEquals(config.discoveryCacheDir, "/tmp/discovery-cache");
});

Deno.test("NeatConfig discoveryCacheDir - accepts relative path", () => {
  const config = createNeatConfig({
    discoveryCacheDir: ".discovery/cache",
  });
  assertEquals(config.discoveryCacheDir, ".discovery/cache");
});

Deno.test("NeatConfig discoveryCacheDir - sets success and failure cache subdirectories", () => {
  const config = createNeatConfig({
    discoveryCacheDir: "/tmp/my-discovery-cache",
  });

  // When discoveryCacheDir is set, it should automatically configure
  // discoverySuccessCacheDir and discoveryFailureCacheDir as subdirectories
  assertExists(config.discoveryCacheDir);
  assertEquals(config.discoveryCacheDir, "/tmp/my-discovery-cache");

  // The success and failure cache dirs should be derived from discoveryCacheDir
  // if not explicitly provided
  assertEquals(
    config.discoverySuccessCacheDir,
    "/tmp/my-discovery-cache/success",
  );
  assertEquals(
    config.discoveryFailureCacheDir,
    "/tmp/my-discovery-cache/failure",
  );
});

Deno.test("NeatConfig discoveryCacheDir - explicit success/failure dirs override derived ones", () => {
  const config = createNeatConfig({
    discoveryCacheDir: "/tmp/my-discovery-cache",
    discoverySuccessCacheDir: "/custom/success",
    discoveryFailureCacheDir: "/custom/failure",
  });

  // Explicit values should override the derived ones
  assertEquals(config.discoverySuccessCacheDir, "/custom/success");
  assertEquals(config.discoveryFailureCacheDir, "/custom/failure");
});

Deno.test("NeatConfig discoveryCacheDir - empty string is treated as undefined", () => {
  const config = createNeatConfig({
    discoveryCacheDir: "",
  });
  assertEquals(config.discoveryCacheDir, undefined);
  assertEquals(config.discoverySuccessCacheDir, undefined);
  assertEquals(config.discoveryFailureCacheDir, undefined);
});
