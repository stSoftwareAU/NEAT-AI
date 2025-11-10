import {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test({
  name: "rust discovery library must be available when FFI tests run",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      assertRustDiscoveryAvailable();
    } finally {
      closeRustLibrary();
    }
  },
});
