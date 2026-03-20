import { assertEquals } from "@std/assert";
import {
  closeRustLibrary,
  isRustDiscoveryEnabled,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

/**
 * Verifies that shouldSkipRustDiscoveryTests() works without requiring the
 * NEAT_RUST_DISCOVERY_OPTIONAL env var. Discovery is always optional — when
 * the Rust library is unavailable, tests should be skipped gracefully without
 * needing any environment variable.
 *
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/1911
 */
Deno.test({
  name:
    "shouldSkipRustDiscoveryTests returns inverse of isRustDiscoveryEnabled without env var",
  sanitizeResources: false,
  fn: () => {
    try {
      const enabled = isRustDiscoveryEnabled();
      const shouldSkip = shouldSkipRustDiscoveryTests();

      // shouldSkip should be true when discovery is NOT enabled, and false when it IS
      assertEquals(
        shouldSkip,
        !enabled,
        `shouldSkipRustDiscoveryTests() should return ${!enabled} when ` +
          `isRustDiscoveryEnabled() is ${enabled}, without requiring ` +
          `NEAT_RUST_DISCOVERY_OPTIONAL env var`,
      );
    } finally {
      closeRustLibrary();
    }
  },
});
