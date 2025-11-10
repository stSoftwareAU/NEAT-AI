import {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
} from "../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

/**
 * Ensures the Rust discovery library can be located and loaded.
 *
 * This keeps the quality gate honest by failing when discovery support has
 * regressed or the Rust artefact is missing.
 */
function main(): void {
  try {
    assertRustDiscoveryAvailable();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Discovery library unavailable. ${message}`);
    Deno.exit(1);
  }
  closeRustLibrary();
}

main();
