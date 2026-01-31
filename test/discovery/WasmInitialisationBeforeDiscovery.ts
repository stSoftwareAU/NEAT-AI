/**
 * Issue #1219 - WASM activation must be initialised before discovery recording
 *
 * Tests that verify WASM is automatically initialised before discovery
 * recording begins, ensuring calling programs don't need to explicitly
 * initialise WASM before using discovery features.
 */
import { assert } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../../src/wasm/mod.ts";
import {
  ensureWasmActivationForDiscovery,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";

/**
 * Tests that WASM gets initialised when not already available
 */
Deno.test({
  name:
    "Issue #1219: ensureWasmActivationForDiscovery initialises WASM when not available",
  async fn() {
    // This test verifies the helper function works correctly.
    // If WASM is already available from previous tests, it should still pass.

    // Ensure WASM is initialised via our helper
    await ensureWasmActivationForDiscovery();

    // Verify WASM is now available
    assert(
      isWasmActivationAvailable(),
      "WASM should be available after ensureWasmActivationForDiscovery()",
    );
  },
});

/**
 * Tests that getWasmDefaultPath returns a valid path
 */
/**
 * Tests that ensureWasmActivationForDiscovery is idempotent
 * (calling it multiple times is safe)
 */
Deno.test({
  name: "Issue #1219: ensureWasmActivationForDiscovery is idempotent",
  async fn() {
    // First call
    await ensureWasmActivationForDiscovery();
    assert(
      isWasmActivationAvailable(),
      "WASM should be available after first call",
    );

    // Second call should not throw
    await ensureWasmActivationForDiscovery();
    assert(
      isWasmActivationAvailable(),
      "WASM should still be available after second call",
    );

    // Third call should also work
    await ensureWasmActivationForDiscovery();
    assert(
      isWasmActivationAvailable(),
      "WASM should still be available after third call",
    );
  },
});

/**
 * Tests that WASM can be manually initialised first, and the ensure function
 * still works (doesn't try to re-initialise)
 */
Deno.test({
  name:
    "Issue #1219: ensureWasmActivationForDiscovery works when WASM already initialised",
  async fn() {
    // Ensure WASM is initialised manually first
    if (!isWasmActivationAvailable()) {
      await initWasmActivation();
    }
    assert(
      isWasmActivationAvailable(),
      "WASM should be available after manual init",
    );

    // Now call our ensure function - should not throw
    await ensureWasmActivationForDiscovery();
    assert(isWasmActivationAvailable(), "WASM should still be available");
  },
});
