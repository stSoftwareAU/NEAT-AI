import { assert, assertEquals } from "@std/assert";

/**
 * Tests bump-deps.sh flag parsing and behaviour.
 *
 * Issue #2435 — add bump-deps.sh: refresh deno deps + neatCore.rev with
 * audit gate. The Vibe Coder worker invokes this script before
 * quality.sh on every PR (see VibeCoding#1613).
 *
 * These tests deliberately avoid the network paths (Develop HEAD
 * resolution, artifact download, registry lookups). They verify:
 *   - flag parsing / help / unknown-option handling
 *   - quarantine value validation
 *   - --dry-run is a true no-op (does not touch deno.json or call out)
 *   - the executable bit is set so the worker can run it directly
 */

async function runBump(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command("bash", {
    args: ["./bump-deps.sh", ...args],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
    env: { PATH: Deno.env.get("PATH") ?? "", ...env },
  });
  const output = await command.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

Deno.test({
  name:
    "bump-deps.sh --help prints usage with internal/external/quarantine sections",
  fn: async () => {
    const result = await runBump(["--help"]);
    assertEquals(result.code, 0, `Expected exit 0; stderr=${result.stderr}`);
    assert(result.stdout.includes("Usage:"), "expected 'Usage:' in help");
    assert(
      result.stdout.includes("--no-internal"),
      "expected --no-internal in help",
    );
    assert(
      result.stdout.includes("--no-external"),
      "expected --no-external in help",
    );
    assert(
      result.stdout.includes("--quarantine-hours") ||
        result.stdout.includes("VIBE_BUMP_QUARANTINE_HOURS"),
      "expected quarantine docs in help",
    );
  },
});

Deno.test({
  name: "bump-deps.sh -h prints usage and exits 0",
  fn: async () => {
    const result = await runBump(["-h"]);
    assertEquals(result.code, 0);
    assert(result.stdout.includes("Usage:"));
  },
});

Deno.test({
  name: "bump-deps.sh rejects unknown flags",
  fn: async () => {
    const result = await runBump(["--no-such-flag"]);
    assert(result.code !== 0, "expected non-zero exit for unknown flag");
    assert(
      result.stderr.includes("Unknown option") ||
        result.stderr.includes("--no-such-flag"),
      `expected Unknown option message; got: ${result.stderr}`,
    );
  },
});

Deno.test({
  name: "bump-deps.sh rejects non-numeric --quarantine-hours",
  fn: async () => {
    const result = await runBump(["--quarantine-hours", "abc"]);
    assert(result.code !== 0, "expected non-zero exit for non-numeric value");
    assert(
      result.stderr.toLowerCase().includes("quarantine"),
      `expected message to mention quarantine; got: ${result.stderr}`,
    );
  },
});

Deno.test({
  name: "bump-deps.sh requires a value for --quarantine-hours",
  fn: async () => {
    const result = await runBump(["--quarantine-hours"]);
    assert(result.code !== 0, "expected non-zero exit when value missing");
  },
});

Deno.test({
  name:
    "bump-deps.sh --dry-run --no-internal --no-external is a true no-op (no deno.json mutation)",
  fn: async () => {
    const before = await Deno.readTextFile("deno.json");
    const result = await runBump([
      "--dry-run",
      "--no-internal",
      "--no-external",
    ]);
    assertEquals(
      result.code,
      0,
      `expected exit 0 for full no-op; stderr=${result.stderr}`,
    );
    assert(
      result.stdout.includes("no bumps") ||
        result.stdout.includes("dry-run") ||
        result.stdout.includes("dry run"),
      `expected dry-run / no-bumps summary; stdout=${result.stdout}`,
    );
    const after = await Deno.readTextFile("deno.json");
    assertEquals(before, after, "dry-run must not mutate deno.json");
  },
});

Deno.test({
  name: "bump-deps.sh accepts VIBE_BUMP_QUARANTINE_HOURS env override",
  fn: async () => {
    const before = await Deno.readTextFile("deno.json");
    // Pass an absurdly large quarantine via env to prove the script reads
    // the env var without erroring; combine with --no-internal/--no-external
    // to keep the run hermetic.
    const result = await runBump([
      "--dry-run",
      "--no-internal",
      "--no-external",
    ], {
      VIBE_BUMP_QUARANTINE_HOURS: "168",
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    const after = await Deno.readTextFile("deno.json");
    assertEquals(before, after, "must not mutate deno.json under --dry-run");
  },
});

Deno.test({
  name: "bump-deps.sh exists and is executable",
  fn: async () => {
    const stat = await Deno.stat("bump-deps.sh");
    assert(stat.isFile, "bump-deps.sh must be a regular file");
    // mode is null on some platforms; only assert when present.
    if (stat.mode !== null) {
      const ownerExec = (stat.mode & 0o100) !== 0;
      assert(ownerExec, "bump-deps.sh must be executable by the owner");
    }
  },
});
