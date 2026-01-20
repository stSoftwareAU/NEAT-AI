import {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test({
  name: "rust discovery library must be available when FFI tests run",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: () => {
    try {
      assertRustDiscoveryAvailable();
    } finally {
      closeRustLibrary();
    }
  },
});
