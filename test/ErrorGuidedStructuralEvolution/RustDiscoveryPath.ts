import { assert } from "@std/assert";
import { findRustLibraryFromOptions } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

function expectedLibraryExtension(): string {
  switch (Deno.build.os) {
    case "darwin":
      return ".dylib";
    case "linux":
      return ".so";
    case "windows":
      return ".dll";
    default:
      throw new Error(`Unsupported platform detected: ${Deno.build.os}`);
  }
}

Deno.test("rust discovery honours NEAT_AI_DISCOVERY_LIB_PATH override", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "rust-lib-override-" });
  const tempHome = await Deno.makeTempDir({ prefix: "rust-lib-home-" });
  const libName = `libneat_ai_discovery${expectedLibraryExtension()}`;
  const fakeLibraryPath = `${tempDir}/${libName}`;

  // Ensure the fake library exists so the resolver can locate it
  await Deno.writeTextFile(fakeLibraryPath, "");

  try {
    const resolved = findRustLibraryFromOptions({
      overridePath: fakeLibraryPath,
      // Force defaults to miss; override should still win regardless.
      homeDir: tempHome,
      cwd: tempHome,
    });
    assert(
      resolved === fakeLibraryPath,
      `Expected override path to win, got ${resolved}`,
    );
  } finally {
    // Use removeSync - simpler, faster, and ensures all file handles are closed
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(tempHome, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
