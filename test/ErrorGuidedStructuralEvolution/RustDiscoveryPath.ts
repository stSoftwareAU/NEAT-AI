import { assert } from "@std/assert";
import { rustLibraryExists } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

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
  const envPermissionStatus = await (async () => {
    try {
      return await Deno.permissions.query({ name: "env" as const });
    } catch {
      return { state: "denied" } as const;
    }
  })();

  if (envPermissionStatus.state !== "granted") {
    console.warn(
      "Skipping NEAT_AI_DISCOVERY_LIB_PATH override test because env permission is not granted.",
    );
    return;
  }

  const originalOverride = (() => {
    try {
      return Deno.env.get("NEAT_AI_DISCOVERY_LIB_PATH");
    } catch {
      return undefined;
    }
  })();

  const originalHome = (() => {
    try {
      return Deno.env.get("HOME");
    } catch {
      return undefined;
    }
  })();

  const originalUserProfile = (() => {
    try {
      return Deno.env.get("USERPROFILE");
    } catch {
      return undefined;
    }
  })();

  const tempDir = await Deno.makeTempDir({ prefix: "rust-lib-override-" });
  const tempHome = await Deno.makeTempDir({ prefix: "rust-lib-home-" });
  const libName = `libneat_ai_discovery${expectedLibraryExtension()}`;
  const fakeLibraryPath = `${tempDir}/${libName}`;

  // Ensure the fake library exists so the resolver can locate it
  await Deno.writeTextFile(fakeLibraryPath, "");

  try {
    // Point HOME/USERPROFILE to empty directories so default search cannot succeed
    Deno.env.set("HOME", tempHome);
    Deno.env.set("USERPROFILE", tempHome);

    assert(
      !rustLibraryExists(),
      "Expected rustLibraryExists() to fail without an override path",
    );

    Deno.env.set("NEAT_AI_DISCOVERY_LIB_PATH", fakeLibraryPath);
    assert(
      rustLibraryExists(),
      "Expected rustLibraryExists() to detect the library via override path",
    );
  } finally {
    const resetEnv = (
      key: string,
      value: string | undefined,
    ) => {
      try {
        if (value === undefined) {
          Deno.env.delete(key);
        } else {
          Deno.env.set(key, value);
        }
      } catch {
        // Ignore env clean-up issues when --allow-env is not granted
      }
    };

    resetEnv("NEAT_AI_DISCOVERY_LIB_PATH", originalOverride);
    resetEnv("HOME", originalHome);
    resetEnv("USERPROFILE", originalUserProfile);

    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(tempHome, { recursive: true });
  }
});
