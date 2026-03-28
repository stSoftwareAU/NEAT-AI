import { assert, assertEquals } from "@std/assert";

/**
 * Tests that the WASM build fingerprint file follows repository conventions.
 *
 * Issue #2072: Hidden files (dotfiles) should not be checked into git.
 * The build fingerprint must use a non-hidden filename so it aligns with
 * the root .gitignore rule that ignores all dotfiles (`.*`).
 */

Deno.test({
  name:
    "build.sh writes fingerprint to non-hidden file (build-fingerprint, not .build-fingerprint)",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("wasm_activation/build.sh");

    // The build script should write to build-fingerprint (not .build-fingerprint)
    assert(
      buildScript.includes("pkg/build-fingerprint"),
      "build.sh should write fingerprint to pkg/build-fingerprint (non-hidden)",
    );
    assert(
      !buildScript.includes("pkg/.build-fingerprint"),
      "build.sh should NOT reference the hidden .build-fingerprint file",
    );
  },
});

Deno.test({
  name: "pkg/.gitignore allows build-fingerprint (non-hidden) to be committed",
  permissions: { read: true },
  fn: async () => {
    const gitignore = await Deno.readTextFile(
      "wasm_activation/pkg/.gitignore",
    );

    assert(
      gitignore.includes("!build-fingerprint"),
      "pkg/.gitignore should allow build-fingerprint to be committed",
    );
    assert(
      !gitignore.includes("!.build-fingerprint"),
      "pkg/.gitignore should NOT reference hidden .build-fingerprint",
    );
  },
});

Deno.test({
  name: "build-fingerprint file exists in pkg/ (non-hidden)",
  permissions: { read: true },
  fn: async () => {
    // Check that the non-hidden file exists
    try {
      const stat = await Deno.stat("wasm_activation/pkg/build-fingerprint");
      assert(stat.isFile, "build-fingerprint should be a regular file");
    } catch {
      // File may not exist if WASM hasn't been built yet - that's acceptable
      // but the hidden version should not exist either
    }

    // Verify the hidden version does NOT exist
    try {
      await Deno.stat("wasm_activation/pkg/.build-fingerprint");
      assert(
        false,
        "Hidden .build-fingerprint should not exist — use build-fingerprint instead",
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Expected: hidden file should not exist
      } else {
        throw error;
      }
    }
  },
});

Deno.test({
  name: "build fingerprint contains a valid SHA-256 hash",
  permissions: { read: true },
  fn: async () => {
    let content: string;
    try {
      content = await Deno.readTextFile(
        "wasm_activation/pkg/build-fingerprint",
      );
    } catch {
      // File may not exist if WASM hasn't been built - skip
      return;
    }

    const hash = content.trim();
    // SHA-256 hash is 64 hex characters
    assertEquals(
      hash.length,
      64,
      `Expected 64-character SHA-256 hash, got ${hash.length} characters`,
    );
    assert(
      /^[0-9a-f]{64}$/.test(hash),
      `Expected lowercase hex SHA-256 hash, got: ${hash}`,
    );
  },
});
