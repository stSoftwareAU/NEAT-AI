import {
  isRustLibraryAvailable,
  rustLibraryExists,
} from "../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

/**
 * Discovery check that verifies the library is available.
 *
 * The library is safe by default (no GPU check) and will not crash.
 *
 * Behavior:
 * - Without --allow-ffi: Only checks if library file exists
 * - With --allow-ffi: Attempts to load library (GPU check is disabled by default)
 */
function main(): void {
  // First check if file exists
  if (!rustLibraryExists()) {
    console.error(
      "❌ Discovery library file not found. Build and install it via the NEAT-AI-Discovery project.",
    );
    Deno.exit(1);
  }

  console.log("✅ Discovery library file found");

  // If we have FFI permissions, try to actually load the library
  try {
    if (typeof Deno.permissions?.querySync === "function") {
      const ffiPermission = Deno.permissions.querySync({ name: "ffi" });
      if (ffiPermission.state === "granted") {
        console.log("🔌 FFI permission granted, attempting to load library...");

        if (isRustLibraryAvailable()) {
          console.log(
            "✅ Discovery library loaded successfully",
          );
        } else {
          console.error(
            "❌ Discovery library exists but could not be loaded. Check library compatibility.",
          );
          Deno.exit(1);
        }
      } else {
        console.log(
          "ℹ️  FFI permission not granted, skipping library load test",
        );
        console.log("   (Run with --allow-ffi to test library loading)");
      }
    }
  } catch (error) {
    console.error(
      "⚠️  Error checking FFI permissions or loading library:",
      error,
    );
    // Don't fail - we already confirmed the file exists
  }
}

main();
