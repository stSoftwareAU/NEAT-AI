import { assert, assertEquals } from "@std/assert";

/**
 * Tests build.sh content-hash verification (issue #2705).
 *
 * The downloaded WASM tarball must be content-verified before extraction
 * (against an optional pin in deno.json neatCore.assetSha256 and/or an
 * upstream sidecar .sha256 file), and a per-file content manifest must
 * be written into wasm_activation/pkg/content-manifest.sha256 so that
 * --verify-only detects post-install tampering.
 */

const MANIFEST_PATH = "wasm_activation/pkg/content-manifest.sha256";

async function runBuild(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command("bash", {
    args: ["./build.sh", ...args],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
    env,
  });
  const output = await command.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await Deno.stat(path);
    return s.isFile;
  } catch {
    return false;
  }
}

Deno.test({
  name: "build.sh declares a content manifest file constant",
  permissions: { read: true },
  fn: async () => {
    const script = await Deno.readTextFile("build.sh");
    assert(
      script.includes("content-manifest.sha256"),
      "build.sh must reference wasm_activation/pkg/content-manifest.sha256",
    );
  },
});

Deno.test({
  name: "build.sh has tarball SHA-256 verification logic",
  permissions: { read: true },
  fn: async () => {
    const script = await Deno.readTextFile("build.sh");
    // Should reference shasum -a 256 (the hashing tool) and assetSha256
    // (the optional deno.json pin) so a reviewer sees how upstream tarballs
    // are content-verified before extract.
    assert(
      /shasum\s+-a\s+256/.test(script),
      "build.sh must use 'shasum -a 256' to hash the downloaded tarball",
    );
    assert(
      script.includes("assetSha256"),
      "build.sh must read neatCore.assetSha256 from deno.json",
    );
    assert(
      script.includes(".sha256"),
      "build.sh must look for a sidecar .sha256 release asset",
    );
  },
});

Deno.test({
  name: "build.sh fails the tarball check on SHA-256 mismatch (helper unit)",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    // Drive the inline helper from build.sh by sourcing the script in a
    // sub-shell with verify_tarball_sha256 invoked against a tmp file.
    const tmpDir = await Deno.makeTempDir({ prefix: "build-sh-test-" });
    try {
      const fakeTar = `${tmpDir}/fake.tar.gz`;
      await Deno.writeTextFile(fakeTar, "not-a-real-tarball");
      // SHA-256 of "not-a-real-tarball" is computed below; pass a
      // deliberately wrong expected hash so the check must fail.
      const wrong = "0".repeat(64);
      const cmd = new Deno.Command("bash", {
        args: [
          "-c",
          `set -e
# Extract just the verify_tarball_sha256 function from build.sh by
# sourcing it inside a guarded sub-shell. We rely on the function name
# being defined at top-level.
source <(awk '/^verify_tarball_sha256\\(\\)/,/^}$/' ./build.sh)
verify_tarball_sha256 "${fakeTar}" "${wrong}" "test-source"
`,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const out = await cmd.output();
      assert(
        out.code !== 0,
        "verify_tarball_sha256 must exit non-zero on mismatch",
      );
      const stderr = new TextDecoder().decode(out.stderr);
      assert(
        stderr.toLowerCase().includes("sha-256") ||
          stderr.toLowerCase().includes("sha256"),
        `Expected stderr to mention SHA-256; got: ${stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "wasm_activation/pkg/content-manifest.sha256 is committed",
  permissions: { read: true },
  fn: async () => {
    assert(
      await fileExists(MANIFEST_PATH),
      `Expected ${MANIFEST_PATH} to exist (commit alongside pkg/**)`,
    );
    const manifest = await Deno.readTextFile(MANIFEST_PATH);
    // Standard sha256sum format: <64-hex>  <filename> per line.
    const lines = manifest.split("\n").filter((l) => l.trim().length > 0);
    assert(lines.length > 0, "content manifest must not be empty");
    for (const line of lines) {
      assert(
        /^[0-9a-f]{64} {2}\S+$/.test(line),
        `Manifest line must be 'sha256  filename'; got: ${line}`,
      );
    }
    // The main artefact must be covered.
    assert(
      manifest.includes("wasm_activation_bg.wasm"),
      "Manifest must include wasm_activation_bg.wasm",
    );
  },
});

Deno.test({
  name: "wasm_activation/pkg/.gitignore allows content-manifest.sha256",
  permissions: { read: true },
  fn: async () => {
    const gi = await Deno.readTextFile("wasm_activation/pkg/.gitignore");
    assert(
      gi.includes("!content-manifest.sha256"),
      "pkg/.gitignore must un-ignore content-manifest.sha256",
    );
  },
});

Deno.test({
  name: "build.sh --verify-only succeeds when bundle matches manifest",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    // Sanity: ensure pin matches before running verify-only.
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const pinnedRev: string = denoConfig.neatCore?.rev ?? "";
    let pkgRev = "";
    try {
      pkgRev = (await Deno.readTextFile(
        "wasm_activation/pkg/neat_core_rev.txt",
      )).trim();
    } catch {
      return;
    }
    if (pinnedRev !== pkgRev) return;
    if (!(await fileExists(MANIFEST_PATH))) return;

    const result = await runBuild(["--verify-only"]);
    assertEquals(
      result.code,
      0,
      `--verify-only should pass on a clean bundle; stderr=${result.stderr}`,
    );
  },
});

Deno.test({
  name: "build.sh --verify-only fails when wasm_activation_bg.wasm is tampered",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    if (!(await fileExists(MANIFEST_PATH))) return;
    const wasmPath = "wasm_activation/pkg/wasm_activation_bg.wasm";
    const original = await Deno.readFile(wasmPath);
    try {
      // Flip the last byte to simulate post-install tampering.
      const tampered = new Uint8Array(original);
      tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
      await Deno.writeFile(wasmPath, tampered);

      const result = await runBuild(["--verify-only"]);
      assert(
        result.code !== 0,
        `--verify-only must fail on bundle tampering; stdout=${result.stdout} stderr=${result.stderr}`,
      );
      assert(
        result.stderr.toLowerCase().includes("manifest") ||
          result.stderr.toLowerCase().includes("sha") ||
          result.stderr.toLowerCase().includes("does not match"),
        `Expected actionable error mentioning manifest/sha; got: ${result.stderr}`,
      );
    } finally {
      // Restore original contents whether the test passed or not.
      await Deno.writeFile(wasmPath, original);
    }
  },
});

Deno.test({
  name: "build.sh --verify-only fails when content-manifest.sha256 is missing",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    if (!(await fileExists(MANIFEST_PATH))) return;
    const backup = await Deno.readTextFile(MANIFEST_PATH);
    try {
      await Deno.remove(MANIFEST_PATH);
      const result = await runBuild(["--verify-only"]);
      assert(
        result.code !== 0,
        `--verify-only must fail when manifest is missing; stdout=${result.stdout} stderr=${result.stderr}`,
      );
    } finally {
      await Deno.writeTextFile(MANIFEST_PATH, backup);
    }
  },
});

Deno.test({
  name: "CORE_DEPENDENCY_POLICY documents the new content-hash step",
  permissions: { read: true },
  fn: async () => {
    const policy = await Deno.readTextFile("docs/CORE_DEPENDENCY_POLICY.md");
    const lower = policy.toLowerCase();
    assert(
      lower.includes("content-manifest.sha256") ||
        lower.includes("content hash") ||
        lower.includes("sha-256") ||
        lower.includes("sha256"),
      "Policy must describe the content-hash verification step",
    );
  },
});
