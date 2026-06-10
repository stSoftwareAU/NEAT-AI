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
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    if (!(await fileExists(MANIFEST_PATH))) return;

    // Use an isolated temp directory so concurrent test runs in BuildScript.ts
    // are not affected by file-system mutations (race condition fix, Issue #2718).
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-tamper-wasm-" });
    try {
      // Copy all necessary pkg files into the temp directory.
      const pkgFiles = [
        "neat_core_rev.txt",
        "wasm_activation.js",
        "wasm_activation_bg.wasm",
        "wasm_activation.d.ts",
        "wasm_activation_bg.wasm.d.ts",
        "package.json",
        "content-manifest.sha256",
      ];
      await Promise.all(
        pkgFiles.map((f) =>
          Deno.copyFile(`wasm_activation/pkg/${f}`, `${tmpDir}/${f}`)
        ),
      );

      // Flip the last byte of the COPY to simulate post-install tampering.
      const wasmCopy = `${tmpDir}/wasm_activation_bg.wasm`;
      const original = await Deno.readFile(wasmCopy);
      const tampered = new Uint8Array(original);
      tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
      await Deno.writeFile(wasmCopy, tampered);

      const result = await runBuild(["--verify-only"], {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? "",
        NEAT_PKG_DIR: tmpDir,
      });
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
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "build.sh --verify-only fails when content-manifest.sha256 is missing",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    if (!(await fileExists(MANIFEST_PATH))) return;

    // Use an isolated temp directory so concurrent test runs in BuildScript.ts
    // are not affected by file-system mutations (race condition fix, Issue #2718).
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-tamper-manifest-" });
    try {
      // Copy all necessary pkg files EXCEPT content-manifest.sha256 into the
      // temp directory, so the manifest is genuinely absent for the check.
      const pkgFiles = [
        "neat_core_rev.txt",
        "wasm_activation.js",
        "wasm_activation_bg.wasm",
        "wasm_activation.d.ts",
        "wasm_activation_bg.wasm.d.ts",
        "package.json",
      ];
      await Promise.all(
        pkgFiles.map((f) =>
          Deno.copyFile(`wasm_activation/pkg/${f}`, `${tmpDir}/${f}`)
        ),
      );

      const result = await runBuild(["--verify-only"], {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? "",
        NEAT_PKG_DIR: tmpDir,
      });
      assert(
        result.code !== 0,
        `--verify-only must fail when manifest is missing; stdout=${result.stdout} stderr=${result.stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

/**
 * Source a single named function out of build.sh into a sub-shell and run a
 * follow-up command against it. Mirrors the existing verify_tarball_sha256
 * helper test; lets us exercise the real bash logic with test data.
 */
async function runSourcedFn(
  fnName: string,
  invocation: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  // Extract the named function out of build.sh and source it from a temp
  // file. A temp file (rather than process substitution) is used because
  // `source <(...)` does not reliably define functions across all bash
  // builds (e.g. macOS bash 3.2).
  const fnTmp = await Deno.makeTempFile({ prefix: "neat-fn-", suffix: ".sh" });
  try {
    const extract = new Deno.Command("awk", {
      args: [`/^${fnName}\\(\\)/,/^}$/`, "./build.sh"],
      stdout: "piped",
      cwd: Deno.cwd(),
    });
    const ex = await extract.output();
    await Deno.writeFile(fnTmp, ex.stdout);

    const script = `set -e\nsource '${fnTmp}'\n${invocation}\n`;
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

Deno.test({
  name: "build.sh --help advertises --allow-unverified",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["--help"]);
    assertEquals(result.code, 0);
    assert(
      result.stdout.includes("--allow-unverified"),
      "Expected help to mention the --allow-unverified flag",
    );
  },
});

Deno.test({
  name: "guard_unverified_extract aborts when no anchor and not allowed",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const deny = await runSourcedFn(
      "guard_unverified_extract",
      'guard_unverified_extract "" false',
    );
    assertEquals(deny.code, 1, "no anchor + not allowed must abort (rc=1)");

    const allow = await runSourcedFn(
      "guard_unverified_extract",
      'guard_unverified_extract "" true',
    );
    assertEquals(allow.code, 0, "--allow-unverified must permit (rc=0)");

    const anchored = await runSourcedFn(
      "guard_unverified_extract",
      'guard_unverified_extract "sidecar wasm.sha256" false',
    );
    assertEquals(anchored.code, 0, "an existing anchor must permit (rc=0)");
  },
});

Deno.test({
  name: "assert_safe_tar_entries rejects path-traversal and absolute entries",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-tar-safety-" });
    try {
      // Safe archive: a normal pkg/ layout extracted under wasm_activation/.
      await Deno.mkdir(`${tmpDir}/src/pkg`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/src/pkg/a.txt`, "ok");
      const mkGood = new Deno.Command("tar", {
        args: ["-czf", `${tmpDir}/good.tar.gz`, "-C", `${tmpDir}/src`, "pkg"],
      });
      assertEquals((await mkGood.output()).code, 0);

      // Traversal archive: member name "../target.txt".
      // Use Python's tarfile module rather than the `tar` CLI because GNU tar
      // (Linux) silently strips leading ".." components when creating archives,
      // which would produce a safe entry name and make the test meaningless.
      // Python tarfile stores the entry name exactly as given, so no real
      // filesystem file is needed — the TarInfo is crafted directly.
      const mkTrav = new Deno.Command("python3", {
        args: [
          "-c",
          [
            "import tarfile, io",
            `archive='${tmpDir}/trav.tar.gz'`,
            "t=tarfile.open(archive,'w:gz')",
            "info=tarfile.TarInfo(name='../target.txt')",
            "content=b'evil'",
            "info.size=len(content)",
            "t.addfile(info,io.BytesIO(content))",
            "t.close()",
          ].join(";"),
        ],
      });
      assertEquals((await mkTrav.output()).code, 0);

      // Absolute-path archive: member name is an absolute path.
      // Also use Python tarfile for the same portability reason.
      const mkAbs = new Deno.Command("python3", {
        args: [
          "-c",
          [
            "import tarfile, io",
            `archive='${tmpDir}/abs.tar.gz'`,
            `target='${tmpDir}/target.txt'`,
            "t=tarfile.open(archive,'w:gz')",
            "info=tarfile.TarInfo(name=target)",
            "content=b'evil'",
            "info.size=len(content)",
            "t.addfile(info,io.BytesIO(content))",
            "t.close()",
          ].join(";"),
        ],
      });
      assertEquals((await mkAbs.output()).code, 0);

      const good = await runSourcedFn(
        "assert_safe_tar_entries",
        `assert_safe_tar_entries '${tmpDir}/good.tar.gz'`,
      );
      assertEquals(
        good.code,
        0,
        `safe archive must pass; stderr=${good.stderr}`,
      );

      const trav = await runSourcedFn(
        "assert_safe_tar_entries",
        `assert_safe_tar_entries '${tmpDir}/trav.tar.gz'`,
      );
      assert(trav.code !== 0, "traversal archive must be rejected");
      assert(
        trav.stderr.includes("path-traversal"),
        `expected path-traversal error; got: ${trav.stderr}`,
      );

      const abs = await runSourcedFn(
        "assert_safe_tar_entries",
        `assert_safe_tar_entries '${tmpDir}/abs.tar.gz'`,
      );
      assert(abs.code !== 0, "absolute-path archive must be rejected");
      assert(
        abs.stderr.includes("absolute-path"),
        `expected absolute-path error; got: ${abs.stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "build.sh extracts without honouring archived owner/permission bits",
  permissions: { read: true },
  fn: async () => {
    const script = await Deno.readTextFile("build.sh");
    assert(
      /tar\s+--no-same-owner\s+--no-same-permissions\s+-xzf/.test(script),
      "tar extract must pass --no-same-owner --no-same-permissions",
    );
  },
});

Deno.test({
  name: "deno.json pins neatCore.assetSha256 so the default build is attested",
  permissions: { read: true },
  fn: async () => {
    const config = JSON.parse(await Deno.readTextFile("deno.json"));
    const pin: string = config.neatCore?.assetSha256 ?? "";
    assert(
      /^[0-9a-f]{64}$/.test(pin),
      `deno.json neatCore.assetSha256 must be a 64-char SHA-256; got '${pin}'`,
    );
  },
});
