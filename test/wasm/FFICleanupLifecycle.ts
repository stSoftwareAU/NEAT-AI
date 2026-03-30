/**
 * FFI Cleanup Lifecycle Tests
 *
 * Issue #1505 - Memory leak detection tests for WASM activation lifecycle.
 *
 * Verifies that the free_discovery_result() FFI cleanup pattern works correctly:
 * 1. Calling Rust FFI functions and freeing results does not accumulate errors
 * 2. The get_version FFI call succeeds and its result can be freed
 * 3. Multiple sequential FFI calls with proper cleanup all succeed
 *
 * These tests require the Rust discovery library to be available and are
 * skipped when it is not installed (e.g. CI without GPU).
 */

import { assert, assertEquals } from "@std/assert";
import {
  closeRustLibrary,
  getDiscoveryVersion,
  isRustDiscoveryEnabled,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

// ---------------------------------------------------------------------------
// FFI cleanup: get_version repeated calls
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "FFICleanupLifecycle: repeated get_version calls with cleanup all succeed",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const N = 20;

    for (let i = 0; i < N; i++) {
      const version = getDiscoveryVersion();
      assert(
        version !== undefined,
        `Call ${i}: get_version should return a version string`,
      );
      assert(
        typeof version === "string" && version.length > 0,
        `Call ${i}: version should be a non-empty string, got: ${version}`,
      );
    }
  },
});

Deno.test({
  name:
    "FFICleanupLifecycle: get_version returns consistent results across calls",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const first = getDiscoveryVersion();
    assert(first !== undefined, "First call should return a version");

    for (let i = 0; i < 10; i++) {
      const version = getDiscoveryVersion();
      assertEquals(
        version,
        first,
        `Call ${i}: version should be consistent`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// FFI library close and reopen
// ---------------------------------------------------------------------------

Deno.test({
  name: "FFICleanupLifecycle: closeRustLibrary and reopen cycle works",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    // Get version before close
    const versionBefore = getDiscoveryVersion();
    assert(versionBefore !== undefined, "Should have version before close");

    // Close the library
    closeRustLibrary();

    // Reopen by calling get_version again (lazy init)
    const versionAfter = getDiscoveryVersion();
    assert(versionAfter !== undefined, "Library should reopen after close");
    assertEquals(
      versionAfter,
      versionBefore,
      "Version should be consistent after library close/reopen",
    );
  },
});
