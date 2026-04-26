import { assert, assertEquals } from "@std/assert";

/**
 * Tests build.sh flag parsing and behaviour.
 *
 * Issue #2433 — auto-sync NEAT-AI with NEAT-AI-core Develop:
 * verifies that ./build.sh now exposes --verify-only and --rev <SHA>
 * flags, has the expected help text, and rejects malformed input
 * without making any network calls.
 *
 * These tests deliberately avoid invoking the network paths
 * (HEAD resolution / artifact download). They focus on:
 *   - flag parsing / help / unknown-option handling
 *   - --verify-only no-op when the vendored bundle matches deno.json
 *   - --rev validation (must be 40-char hex)
 */

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

Deno.test({
  name: "build.sh --help prints usage and lists new flags",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["--help"]);
    assertEquals(result.code, 0, "Expected exit code 0 for --help");
    assert(
      result.stdout.includes("Usage:"),
      "Expected help output to contain 'Usage:'",
    );
    assert(
      result.stdout.includes("--verify-only"),
      "Expected help to mention --verify-only flag",
    );
    assert(
      result.stdout.includes("--rev"),
      "Expected help to mention --rev flag",
    );
    assert(
      result.stdout.includes("--clean"),
      "Expected help to retain --clean flag",
    );
  },
});

Deno.test({
  name: "build.sh -h prints usage and exits 0",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["-h"]);
    assertEquals(result.code, 0, "Expected exit code 0 for -h");
    assert(
      result.stdout.includes("Usage:"),
      "Expected help output to contain 'Usage:'",
    );
  },
});

Deno.test({
  name: "build.sh rejects unknown flags",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["--no-such-flag"]);
    assert(result.code !== 0, "Expected non-zero exit code for unknown flag");
    assert(
      result.stderr.includes("Unknown option"),
      "Expected error message about unknown option",
    );
  },
});

Deno.test({
  name: "build.sh --rev rejects non-hex / wrong-length values",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["--rev", "not-a-sha"]);
    assert(
      result.code !== 0,
      "Expected non-zero exit for invalid --rev",
    );
    assert(
      result.stderr.includes("--rev"),
      "Expected error to mention --rev",
    );
  },
});

Deno.test({
  name: "build.sh --rev requires a value",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runBuild(["--rev"]);
    assert(
      result.code !== 0,
      "Expected non-zero exit when --rev has no value",
    );
  },
});

Deno.test({
  name: "build.sh --verify-only is a no-op when vendored bundle matches pin",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    // Sanity: the repo state at the start of the test should already
    // satisfy the verify-only contract (pkg matches deno.json rev).
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const pinnedRev: string = denoConfig.neatCore?.rev ?? "";
    let pkgRev = "";
    try {
      pkgRev = (await Deno.readTextFile(
        "wasm_activation/pkg/neat_core_rev.txt",
      )).trim();
    } catch {
      // pkg missing — skip rather than fail (handled by other tests)
      return;
    }
    if (pinnedRev !== pkgRev) {
      // Repo isn't in sync — skip; not what this test is checking.
      return;
    }

    const result = await runBuild(["--verify-only"]);
    assertEquals(
      result.code,
      0,
      `Expected --verify-only to succeed for in-sync repo; stderr=${result.stderr}`,
    );
    assert(
      result.stdout.includes("Skipping build") ||
        result.stdout.includes("matches"),
      "Expected --verify-only to print a no-op message",
    );
  },
});

Deno.test({
  name: "build.sh --verify-only does not resolve HEAD over the network",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // If build.sh tried to call gh / curl in verify-only mode and the
    // bundle is in sync, this would fail offline. Test it succeeds with
    // a clearly-bogus repo and ref env override, proving network is not
    // contacted on the verify-only path.
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
    if (pinnedRev !== pkgRev) {
      return;
    }

    const result = await runBuild(["--verify-only"], {
      // PATH is required so deno/bash resolve.
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      // Force resolution code-path to obvious failure if it ran.
      NEAT_CORE_REPO: "stSoftwareAU/does-not-exist-zzz",
      NEAT_CORE_REF: "no-such-branch",
    });
    assertEquals(
      result.code,
      0,
      `--verify-only must skip network lookup; stderr=${result.stderr}`,
    );
  },
});

Deno.test({
  name: "build.sh exposes a --rev option for explicit historical pins",
  permissions: { read: true },
  fn: async () => {
    const buildScript = await Deno.readTextFile("build.sh");
    assert(
      buildScript.includes("--rev"),
      "build.sh should accept --rev <SHA> for explicit pinning",
    );
    assert(
      /wasm-bundle-/.test(buildScript),
      "build.sh should reference per-commit Release tag pattern wasm-bundle-<SHA>",
    );
    assert(
      buildScript.includes("wasm_activation-pkg.tar.gz"),
      "build.sh should reference the wasm_activation-pkg.tar.gz asset",
    );
  },
});

Deno.test({
  name: "CORE_DEPENDENCY_POLICY documents the new artifact-based flow",
  permissions: { read: true },
  fn: async () => {
    const policy = await Deno.readTextFile("docs/CORE_DEPENDENCY_POLICY.md");
    const lower = policy.toLowerCase();
    assert(
      lower.includes("wasm_activation-pkg.tar.gz") ||
        lower.includes("wasm-bundle-"),
      "Policy must describe the per-commit Release artifact",
    );
    assert(
      lower.includes("--verify-only") || lower.includes("verify-only"),
      "Policy must describe the verify-only mode",
    );
    assert(
      lower.includes("--rev") || lower.includes("rev <sha>"),
      "Policy must describe the --rev <SHA> override",
    );
  },
});
