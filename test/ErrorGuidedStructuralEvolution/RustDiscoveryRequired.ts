import {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
  shouldSkipRustDiscoveryTests,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test({
  name: "rust discovery library must be available when FFI tests run",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  fn: () => {
    try {
      assertRustDiscoveryAvailable();
    } finally {
      closeRustLibrary();
    }
  },
});
