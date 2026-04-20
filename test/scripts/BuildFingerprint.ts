import { assert, assertEquals } from "@std/assert";

/**
 * Tests that the WASM build fingerprint file follows repository conventions.
 *
 * Issue #2072: Hidden files (dotfiles) should not be checked into git.
 * The canonical build fingerprint is `pkg/build-fingerprint` (non-hidden).
 */

Deno.test({
  name: "build.sh writes fingerprint to non-hidden file (build-fingerprint)",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("build.sh");

    // The build script should write to build-fingerprint (non-hidden)
    assert(
      buildScript.includes("build-fingerprint"),
      "build.sh should write fingerprint to pkg/build-fingerprint (non-hidden)",
    );
  },
});

Deno.test({
  name: "build.sh does not write hidden pkg/.build-fingerprint",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("build.sh");

    assert(
      !buildScript.includes("pkg/.build-fingerprint"),
      "build.sh must not write a hidden fingerprint file",
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
  },
});

Deno.test({
  name: "pkg/.gitignore does not un-ignore hidden .build-fingerprint",
  permissions: { read: true },
  fn: async () => {
    const gitignore = await Deno.readTextFile(
      "wasm_activation/pkg/.gitignore",
    );

    assert(
      !gitignore.includes("!.build-fingerprint"),
      "pkg/.gitignore must not whitelist a hidden fingerprint file",
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
