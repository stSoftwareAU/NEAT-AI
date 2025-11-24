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

        try {
        // Note: If the library crashes on load (segfault), Deno will kill the process
        // with "Killed: 9" and we can't catch that. The process will exit before
        // we can handle it. This usually indicates:
        // - Architecture mismatch (x86_64 vs arm64)
        // - Missing dependencies
        // - Library built for different macOS version
        // - Bug in library initialization
        if (isRustLibraryAvailable()) {
          console.log(
            "✅ Discovery library loaded successfully",
          );
        } else {
          console.error(
            "❌ Discovery library exists but could not be loaded.",
          );
          console.error("   Possible causes:");
          console.error("   - Architecture mismatch (check: file ~/.cargo/lib/libneat_ai_discovery.dylib)");
          console.error("   - Missing dependencies (run: otool -L ~/.cargo/lib/libneat_ai_discovery.dylib)");
          console.error("   - Library built for different macOS version");
          console.error("   - Bug in library initialization");
          console.error("   Solution: Rebuild the library in ../NEAT-AI-Discovery");
          Deno.exit(1);
        }
        } catch (loadError) {
          // If the library crashes on load (e.g., segmentation fault),
          // Deno might kill the process with "Killed: 9"
          // We can't catch that, but we can at least log what we know
          console.error(
            "❌ Discovery library crashed during load (likely segmentation fault or library incompatibility)",
          );
          console.error("   Error:", loadError);
          console.error("   This usually indicates:");
          console.error("   - Library architecture mismatch (e.g., x86_64 vs arm64)");
          console.error("   - Missing dependencies");
          console.error("   - Library built for different macOS version");
          console.error("   - Bug in library initialization");
          console.error("   Solution: Rebuild the library in ../NEAT-AI-Discovery");
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
