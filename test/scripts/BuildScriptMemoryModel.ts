/**
 * Issue #3743 — build.sh must select the release asset for the declared memory
 * model and refuse a bundle whose linear memory is the wrong address size.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runSourcedFns } from "./_buildShHarness.ts";

/** Smallest valid module declaring one memory; flags bit 2 marks Memory64. */
function memoryOnlyModule(flags: number): Uint8Array {
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x05,
    0x03,
    0x01,
    flags,
    0x01,
  ]);
}

Deno.test({
  name: "deno.json pins the wasm64 (Memory64) bundle",
  permissions: { read: true },
  fn: async () => {
    const config = JSON.parse(await Deno.readTextFile("deno.json"));
    assertEquals(
      config.neatCore?.memoryModel,
      "wasm64",
      "deno.json neatCore.memoryModel must declare the Memory64 bundle",
    );
  },
});

Deno.test({
  name: "select_bundle_asset_name maps each model onto its release asset",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const run = await runSourcedFns(
      ["select_bundle_asset_name"],
      "select_bundle_asset_name wasm32; select_bundle_asset_name wasm64",
    );
    assertEquals(run.code, 0, `expected success; stderr=${run.stderr}`);
    assertEquals(run.stdout.trim().split("\n"), [
      "wasm_activation-pkg.tar.gz",
      "wasm_activation-wasm64-pkg.tar.gz",
    ]);
  },
});

Deno.test({
  name:
    "select_bundle_asset_name refuses an unknown model rather than guessing",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const run = await runSourcedFns(
      ["select_bundle_asset_name"],
      "select_bundle_asset_name wasm128",
    );
    assert(run.code !== 0, "an unknown model must fail");
    assertEquals(
      run.stdout.trim(),
      "",
      "an unknown model must not print a fallback asset name",
    );
    assertStringIncludes(run.stderr, "wasm128");
  },
});

Deno.test({
  name: "assert_wasm_memory_model accepts the vendored wasm64 bundle",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const run = await runSourcedFns(
      ["assert_wasm_memory_model"],
      "assert_wasm_memory_model wasm_activation/pkg/wasm_activation_bg.wasm wasm64",
    );
    assertEquals(
      run.code,
      0,
      `vendored bundle must be wasm64; stderr=${run.stderr}`,
    );
  },
});

Deno.test({
  name: "assert_wasm_memory_model rejects a wasm32 bundle under a wasm64 pin",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-memmodel-" });
    try {
      const wasmPath = `${tmpDir}/wasm_activation_bg.wasm`;
      await Deno.writeFile(wasmPath, memoryOnlyModule(0x00));
      const run = await runSourcedFns(
        ["assert_wasm_memory_model"],
        `assert_wasm_memory_model '${wasmPath}' wasm64`,
      );
      assert(run.code !== 0, "an i32 bundle under a wasm64 pin must fail");
      assertStringIncludes(run.stderr, "wasm32");
      assertStringIncludes(run.stderr, "wasm64");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "assert_wasm_memory_model accepts a wasm64 bundle under a wasm64 pin",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-memmodel-ok-" });
    try {
      const wasmPath = `${tmpDir}/wasm_activation_bg.wasm`;
      await Deno.writeFile(wasmPath, memoryOnlyModule(0x04));
      const run = await runSourcedFns(
        ["assert_wasm_memory_model"],
        `assert_wasm_memory_model '${wasmPath}' wasm64`,
      );
      assertEquals(run.code, 0, `expected success; stderr=${run.stderr}`);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "assert_wasm_memory_model fails loud when the bundle is missing",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const run = await runSourcedFns(
      ["assert_wasm_memory_model"],
      "assert_wasm_memory_model /nonexistent/wasm_activation_bg.wasm wasm64",
    );
    assert(run.code !== 0, "a missing bundle must fail");
    assertStringIncludes(run.stderr, "does not exist");
  },
});

Deno.test({
  name:
    "prune_stale_optional_files drops metadata the new bundle stopped shipping",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-prune-" });
    try {
      const pkgDir = `${tmpDir}/pkg`;
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeTextFile(`${pkgDir}/package.json`, "{}\n");
      await Deno.writeTextFile(`${pkgDir}/wasm_activation.js`, "//\n");

      // Tarball carrying only the glue — no package.json, like the wasm64 lane.
      const archive = `${tmpDir}/bundle.tar.gz`;
      const tar = await new Deno.Command("tar", {
        args: ["-czf", archive, "-C", tmpDir, "pkg/wasm_activation.js"],
        stdin: "null",
      }).output();
      assertEquals(tar.code, 0, "tar must build the fixture archive");

      const run = await runSourcedFns(
        ["prune_stale_optional_files"],
        `DEST_DIR='${pkgDir}'; manifest_optional=("package.json"); ` +
          `prune_stale_optional_files '${archive}'`,
      );
      assertEquals(run.code, 0, `prune must succeed; stderr=${run.stderr}`);
      assertStringIncludes(run.stdout, "Pruning");
      assertEquals(
        await fileExists(`${pkgDir}/package.json`),
        false,
        "stale package.json must be removed",
      );
      assertEquals(
        await fileExists(`${pkgDir}/wasm_activation.js`),
        true,
        "shipped files must be left alone",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "prune_stale_optional_files keeps metadata the bundle still ships",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-prune-keep-" });
    try {
      const pkgDir = `${tmpDir}/pkg`;
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeTextFile(`${pkgDir}/package.json`, "{}\n");

      const archive = `${tmpDir}/bundle.tar.gz`;
      const tar = await new Deno.Command("tar", {
        args: ["-czf", archive, "-C", tmpDir, "pkg/package.json"],
        stdin: "null",
      }).output();
      assertEquals(tar.code, 0, "tar must build the fixture archive");

      const run = await runSourcedFns(
        ["prune_stale_optional_files"],
        `DEST_DIR='${pkgDir}'; manifest_optional=("package.json"); ` +
          `prune_stale_optional_files '${archive}'`,
      );
      assertEquals(run.code, 0, `prune must succeed; stderr=${run.stderr}`);
      assertEquals(
        await fileExists(`${pkgDir}/package.json`),
        true,
        "a shipped package.json must be kept",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "write_runtime_bundle_pin refuses to write without a memory model",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-nomodel-" });
    try {
      const pkgDir = `${tmpDir}/pkg`;
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeFile(
        `${pkgDir}/wasm_activation_bg.wasm`,
        memoryOnlyModule(0x04),
      );
      const pinFile = `${tmpDir}/WasmBundleSha256.ts`;

      const run = await runSourcedFns(
        ["write_runtime_bundle_pin"],
        `DEST_DIR='${pkgDir}' RUNTIME_PIN_FILE='${pinFile}' write_runtime_bundle_pin`,
      );
      assert(run.code !== 0, "an unset MEMORY_MODEL must fail loud");
      assertStringIncludes(run.stderr, "MEMORY_MODEL");
      assertEquals(
        await fileExists(pinFile),
        false,
        "no pin may be written when the model is unknown",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "write_runtime_bundle_pin records the declared memory model",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-model-" });
    try {
      const pkgDir = `${tmpDir}/pkg`;
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeFile(
        `${pkgDir}/wasm_activation_bg.wasm`,
        memoryOnlyModule(0x04),
      );
      const pinFile = `${tmpDir}/WasmBundleSha256.ts`;

      const run = await runSourcedFns(
        ["write_runtime_bundle_pin"],
        `DEST_DIR='${pkgDir}' RUNTIME_PIN_FILE='${pinFile}' MEMORY_MODEL=wasm64 write_runtime_bundle_pin`,
      );
      assertEquals(run.code, 0, `pin must be written; stderr=${run.stderr}`);
      const generated = await Deno.readTextFile(pinFile);
      assertStringIncludes(
        generated,
        'export const EXPECTED_WASM_MEMORY_MODEL: WasmMemoryModel = "wasm64"',
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
