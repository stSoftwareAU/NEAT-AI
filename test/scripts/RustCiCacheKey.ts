import { assert, assertEquals, assertNotEquals } from "@std/assert";

/**
 * Tests for scripts/rust-ci-cache-key.sh.
 *
 * Issue #2344 — CI: tune cache keys for Cargo.lock when the external
 * NEAT-AI-core git `rev` changes. The helper emits a stable cache key
 * that invalidates when any hashed input (Cargo.toml, Cargo.lock,
 * build.sh, or an embedded git `rev`/`tag`/`branch`) changes.
 */

const SCRIPT = "scripts/rust-ci-cache-key.sh";

async function runCacheKey(cwd: string, args: string[] = []): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const cmd = new Deno.Command("bash", {
    args: [`${Deno.cwd()}/${SCRIPT}`, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout).trim(),
    stderr: new TextDecoder().decode(stderr).trim(),
  };
}

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "rust-ci-cache-key-" });
  const entries = Object.entries(files);
  await Promise.all(entries.map(async ([path, content]) => {
    const full = `${dir}/${path}`;
    await Deno.mkdir(full.substring(0, full.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(full, content);
  }));
  return dir;
}

Deno.test("rust-ci-cache-key.sh exists and is executable", async () => {
  const info = await Deno.stat(SCRIPT);
  assert(info.isFile, `${SCRIPT} should be a file`);
  // Not asserting exact perms because CI checkout flags may differ; just
  // make sure the file is invokable under bash below.
  const { code } = await runCacheKey(Deno.cwd(), ["--help"]);
  assertEquals(code, 0, "--help should exit 0");
});

Deno.test("rust-ci-cache-key.sh emits a non-empty hex digest", async () => {
  const dir = await makeFixture({
    "wasm_activation/Cargo.toml": `[package]
name = "wasm_activation"
version = "0.1.0"
[dependencies]
wasm-bindgen = "=0.2.100"
`,
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  });
  const { code, stdout, stderr } = await runCacheKey(dir);
  assertEquals(code, 0, `expected exit 0, stderr=${stderr}`);
  assert(
    /^[0-9a-f]{32,}$/.test(stdout),
    `expected hex digest, got: '${stdout}'`,
  );
});

Deno.test("rust-ci-cache-key.sh is deterministic for identical inputs", async () => {
  const files = {
    "wasm_activation/Cargo.toml": `[package]
name = "wasm_activation"
[dependencies]
wasm-bindgen = "=0.2.100"
`,
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  };
  const dir1 = await makeFixture(files);
  const dir2 = await makeFixture(files);
  const a = await runCacheKey(dir1);
  const b = await runCacheKey(dir2);
  assertEquals(a.code, 0);
  assertEquals(b.code, 0);
  assertEquals(a.stdout, b.stdout, "same inputs must produce same key");
});

Deno.test("rust-ci-cache-key.sh changes when Cargo.toml changes", async () => {
  const baseFiles = {
    "wasm_activation/Cargo.toml": `[package]
name = "wasm_activation"
[dependencies]
wasm-bindgen = "=0.2.100"
`,
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  };
  const dir1 = await makeFixture(baseFiles);
  const dir2 = await makeFixture({
    ...baseFiles,
    "wasm_activation/Cargo.toml": baseFiles["wasm_activation/Cargo.toml"]
      .replace("=0.2.100", "=0.2.101"),
  });
  const a = await runCacheKey(dir1);
  const b = await runCacheKey(dir2);
  assertNotEquals(a.stdout, b.stdout, "cargo dependency bump must bust key");
});

Deno.test("rust-ci-cache-key.sh changes when a git dep rev changes", async () => {
  const baseCargo = `[package]
name = "wasm_activation"
[dependencies]
wasm-bindgen = "=0.2.100"
neat-ai-core = { git = "https://github.com/stSoftwareAU/NEAT-AI-core.git", rev = "aaaaaaa" }
`;
  const dir1 = await makeFixture({
    "wasm_activation/Cargo.toml": baseCargo,
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  });
  const dir2 = await makeFixture({
    "wasm_activation/Cargo.toml": baseCargo.replace("aaaaaaa", "bbbbbbb"),
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  });
  const a = await runCacheKey(dir1);
  const b = await runCacheKey(dir2);
  assertEquals(a.code, 0, `stderr=${a.stderr}`);
  assertEquals(b.code, 0, `stderr=${b.stderr}`);
  assertNotEquals(
    a.stdout,
    b.stdout,
    "changing the git rev of a dependency must bust the cache key",
  );
});

Deno.test("rust-ci-cache-key.sh includes Cargo.lock when present", async () => {
  const cargo = `[package]
name = "wasm_activation"
[dependencies]
wasm-bindgen = "=0.2.100"
`;
  const build = "#!/bin/bash\necho build\n";
  const dirNoLock = await makeFixture({
    "wasm_activation/Cargo.toml": cargo,
    "wasm_activation/build.sh": build,
  });
  const dirWithLock = await makeFixture({
    "wasm_activation/Cargo.toml": cargo,
    "wasm_activation/build.sh": build,
    "wasm_activation/Cargo.lock": `# Lock v1\nversion = 4\n`,
  });
  const a = await runCacheKey(dirNoLock);
  const b = await runCacheKey(dirWithLock);
  assertEquals(a.code, 0);
  assertEquals(b.code, 0);
  assertNotEquals(
    a.stdout,
    b.stdout,
    "the presence of Cargo.lock should affect the key",
  );
});

Deno.test("rust-ci-cache-key.sh fails cleanly when Cargo.toml is missing", async () => {
  const dir = await makeFixture({
    "README.md": "no cargo here\n",
  });
  const { code, stderr } = await runCacheKey(dir);
  assertNotEquals(code, 0, "missing Cargo.toml must fail");
  assert(
    stderr.toLowerCase().includes("cargo.toml"),
    `error should mention Cargo.toml, got: ${stderr}`,
  );
});

Deno.test("rust-ci-cache-key.sh --prefix prepends a label", async () => {
  const dir = await makeFixture({
    "wasm_activation/Cargo.toml":
      `[package]\nname = "wasm_activation"\n[dependencies]\nwasm-bindgen = "=0.2.100"\n`,
    "wasm_activation/build.sh": "#!/bin/bash\necho build\n",
  });
  const { code, stdout } = await runCacheKey(dir, [
    "--prefix",
    "linux-cargo-wasm",
  ]);
  assertEquals(code, 0);
  assert(
    stdout.startsWith("linux-cargo-wasm-"),
    `expected prefix, got: ${stdout}`,
  );
  const digest = stdout.replace(/^linux-cargo-wasm-/, "");
  assert(/^[0-9a-f]{32,}$/.test(digest), `expected hex digest: ${digest}`);
});
