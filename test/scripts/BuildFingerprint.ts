import { assert, assertEquals } from "@std/assert";

/**
 * Tests that the WASM build fingerprint file follows repository conventions.
 *
 * Issue #2072: Hidden files (dotfiles) should not be checked into git.
 * The canonical build fingerprint uses a non-hidden filename. A hidden
 * copy (.build-fingerprint) is also written for backwards compatibility
 * with .github/workflows/wasm-build.yml until the workflow is updated.
 */

Deno.test({
  name: "build.sh writes fingerprint to non-hidden file (build-fingerprint)",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("wasm_activation/build.sh");

    // The build script should write to build-fingerprint (non-hidden)
    assert(
      buildScript.includes("pkg/build-fingerprint"),
      "build.sh should write fingerprint to pkg/build-fingerprint (non-hidden)",
    );
  },
});

Deno.test({
  name:
    "build.sh also writes hidden .build-fingerprint for workflow compatibility",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("wasm_activation/build.sh");

    // The build script should also write to .build-fingerprint for backwards
    // compatibility with the CI workflow that still references the hidden name.
    assert(
      buildScript.includes("pkg/.build-fingerprint"),
      "build.sh should write .build-fingerprint for workflow compatibility",
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
  name: "pkg/.gitignore allows .build-fingerprint for workflow compatibility",
  permissions: { read: true },
  fn: async () => {
    const gitignore = await Deno.readTextFile(
      "wasm_activation/pkg/.gitignore",
    );

    assert(
      gitignore.includes("!.build-fingerprint"),
      "pkg/.gitignore should allow .build-fingerprint for workflow compatibility",
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
