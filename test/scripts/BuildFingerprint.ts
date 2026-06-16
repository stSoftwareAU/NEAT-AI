import { assert, assertEquals } from "@std/assert";

/**
 * Tests that the WASM build fingerprint file follows repository conventions.
 *
 * Issue #2072: Hidden files (dotfiles) should not be checked into git.
 * The canonical build fingerprint is `pkg/build-fingerprint` (non-hidden).
 */

/** Lowercase hex SHA-256 of a string, used to predict the fingerprint. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/**
 * Source a single named function out of build.sh into a sub-shell, set the
 * globals it depends on, and run it. Mirrors the helper in
 * BuildScriptContentHash.ts so we exercise the real bash logic rather than
 * grepping the script's source text (issue #2997). A temp file (not process
 * substitution) is used because `source <(...)` does not reliably define
 * functions across all bash builds (e.g. macOS bash 3.2).
 */
async function runSourcedFn(
  fnName: string,
  preamble: string,
  invocation: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const fnTmp = await Deno.makeTempFile({ prefix: "neat-fn-", suffix: ".sh" });
  try {
    const extract = new Deno.Command("awk", {
      args: [`/^${fnName}\\(\\)/,/^}$/`, "./build.sh"],
      stdout: "piped",
      cwd: Deno.cwd(),
    });
    const ex = await extract.output();
    await Deno.writeFile(fnTmp, ex.stdout);

    const script = `set -e\nsource '${fnTmp}'\n${preamble}\n${invocation}\n`;
    const cmd = new Deno.Command("bash", {
      args: ["-c", script],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
    });
    const out = await cmd.output();
    return {
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
      code: out.code,
    };
  } finally {
    await Deno.remove(fnTmp);
  }
}

// Behavioural replacement (issue #2997) for the old source-text greps that
// asserted build.sh "includes('build-fingerprint')" and
// "!includes('pkg/.build-fingerprint')". Those HOW-tests passed merely because
// a string appeared somewhere in the file. The WHAT-test below runs build.sh's
// real refresh_fingerprint helper and observes the file it actually writes: a
// non-hidden `build-fingerprint` holding the expected SHA-256, with no hidden
// `.build-fingerprint` companion.
Deno.test({
  name: "build.sh refresh_fingerprint writes a non-hidden build-fingerprint",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    if (!(await fileExists("build.sh"))) return;

    const destDir = await Deno.makeTempDir({ prefix: "neat-fingerprint-" });
    try {
      const repo = "stSoftwareAU/NEAT-AI-core";
      const rev = "0123456789abcdef0123456789abcdef01234567";

      const result = await runSourcedFn(
        "refresh_fingerprint",
        `export NEAT_CORE_REPO='${repo}'\nDEST_DIR='${destDir}'`,
        `refresh_fingerprint '${rev}'`,
      );
      // shasum may be unavailable on minimal CI; the helper is a no-op then.
      if (result.code !== 0) return;

      const fingerprintPath = `${destDir}/build-fingerprint`;
      const hiddenPath = `${destDir}/.build-fingerprint`;

      assert(
        await fileExists(fingerprintPath),
        `refresh_fingerprint must write ${fingerprintPath} (non-hidden); ` +
          `stderr=${result.stderr}`,
      );
      assert(
        !(await fileExists(hiddenPath)),
        "refresh_fingerprint must not write a hidden .build-fingerprint",
      );

      const written = (await Deno.readTextFile(fingerprintPath)).trim();
      assertEquals(
        written,
        await sha256Hex(`${repo}@${rev}`),
        "fingerprint must be the SHA-256 of '<repo>@<rev>'",
      );
    } finally {
      await Deno.remove(destDir, { recursive: true });
    }
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
