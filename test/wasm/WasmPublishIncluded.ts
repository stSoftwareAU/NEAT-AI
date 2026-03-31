import { assert } from "@std/assert";

/**
 * Issue #2112: Verify WASM activation files are included in the published package.
 *
 * The global exclude in deno.json must not prevent wasm_activation/pkg files
 * from being published to JSR. Without these files, consumers get 404 errors
 * when the library tries to load WASM activation.
 */

Deno.test({
  name:
    "Issue #2112: wasm_activation/pkg files are included in deno publish output",
  permissions: { run: true, read: true },
  fn: async () => {
    const command = new Deno.Command("deno", {
      args: ["publish", "--dry-run", "--allow-dirty"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    const combined = stdout + stderr;

    assert(
      combined.includes("wasm_activation/pkg/wasm_activation.js"),
      "deno publish must include wasm_activation.js — " +
        "without it, JSR consumers get 404 when loading WASM activation. " +
        "Check that wasm_activation/pkg is not in the global exclude in deno.json.",
    );

    assert(
      combined.includes("wasm_activation/pkg/wasm_activation_bg.wasm"),
      "deno publish must include wasm_activation_bg.wasm — " +
        "without it, JSR consumers get 404 when loading WASM binary. " +
        "Check that wasm_activation/pkg is not in the global exclude in deno.json.",
    );
  },
});

Deno.test({
  name:
    "Issue #2112: wasm_activation/pkg files exist on disk for local consumers",
  permissions: { read: true },
  fn: () => {
    // Verify the WASM files exist locally so that file: URL consumers
    // (local checkouts) can load them.
    const jsInfo = Deno.statSync("wasm_activation/pkg/wasm_activation.js");
    assert(jsInfo.isFile, "wasm_activation.js must be a regular file");
    assert(jsInfo.size > 0, "wasm_activation.js must not be empty");

    const wasmInfo = Deno.statSync(
      "wasm_activation/pkg/wasm_activation_bg.wasm",
    );
    assert(wasmInfo.isFile, "wasm_activation_bg.wasm must be a regular file");
    assert(wasmInfo.size > 0, "wasm_activation_bg.wasm must not be empty");
  },
});
