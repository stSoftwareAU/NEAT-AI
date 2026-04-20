import { assert, assertEquals } from "@std/assert";

/**
 * Tests that local formatting matches CI formatting.
 *
 * Issue #2100: quality.sh used explicit paths for `deno fmt` while CI used
 * `deno fmt` without paths (which formats all files). This mismatch caused
 * CI to reformat generated WASM pkg files that quality.sh never touched,
 * leading to spurious commits and WASM rebuilds.
 *
 * The fix: deno.json excludes the vendored generated directory
 * (wasm_activation/pkg) and quality.sh runs `deno fmt` without explicit
 * paths, matching CI exactly.
 */

Deno.test({
  name: "deno fmt --check passes with no path arguments (CI-consistent)",
  permissions: { run: true, read: true },
  fn: async () => {
    // Run `deno fmt --check` with no explicit paths, exactly as CI does.
    // This should exit 0 if everything is already formatted.
    const command = new Deno.Command("deno", {
      args: ["fmt", "--check"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
    });
    const output = await command.output();
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(
      output.code,
      0,
      `deno fmt --check (no path args) should pass cleanly. ` +
        `If this fails, the project has formatting inconsistencies ` +
        `between quality.sh and CI. stderr: ${stderr}`,
    );
  },
});

Deno.test({
  name: "wasm_activation/pkg files are not touched by deno fmt",
  permissions: { run: true, read: true },
  fn: async () => {
    // Verify that `deno fmt --check` does not list any wasm_activation/pkg files.
    // If the exclude is working, these generated files won't appear in the output.
    const command = new Deno.Command("deno", {
      args: ["fmt", "--check"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
    });
    const output = await command.output();
    const stderr = new TextDecoder().decode(output.stderr);
    const stdout = new TextDecoder().decode(output.stdout);
    const combined = stdout + stderr;

    assert(
      !combined.includes("wasm_activation/pkg"),
      `deno fmt should not touch wasm_activation/pkg files. ` +
        `These are vendored generated outputs and must be excluded ` +
        `to prevent CI/local formatting discrepancies. ` +
        `Output: ${combined}`,
    );
  },
});
