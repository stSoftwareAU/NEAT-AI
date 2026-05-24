import { assert, assertEquals } from "@std/assert";

/**
 * Tests for quality.sh flag parsing and behaviour.
 *
 * These tests invoke quality.sh with --dry-run to verify flag parsing
 * without actually running the quality steps.
 */

/** Helper to run quality.sh with given args and return stdout + exit code. */
async function runQuality(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command("bash", {
    args: ["./quality.sh", ...args],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });
  const output = await command.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

Deno.test(
  {
    name: "quality.sh --help prints usage and exits 0",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assertEquals(result.code, 0, "Expected exit code 0 for --help");
      assert(
        result.stdout.includes("Usage:"),
        "Expected help output to contain 'Usage:'",
      );
      assert(
        result.stdout.includes("--help"),
        "Expected help output to mention --help flag",
      );
      assert(
        result.stdout.includes("--skip-tests"),
        "Expected help output to mention --skip-tests flag",
      );
      assert(
        result.stdout.includes("--skip-discovery"),
        "Expected help output to mention --skip-discovery flag",
      );
      assert(
        result.stdout.includes("--lint-only"),
        "Expected help output to mention --lint-only flag",
      );
      assert(
        result.stdout.includes("--check-only"),
        "Expected help output to mention --check-only flag",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh -h prints usage and exits 0",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["-h"]);
      assertEquals(result.code, 0, "Expected exit code 0 for -h");
      assert(
        result.stdout.includes("Usage:"),
        "Expected help output to contain 'Usage:'",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run shows steps without executing them",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run"]);
      assertEquals(result.code, 0, "Expected exit code 0 for --dry-run");
      assert(
        result.stdout.includes("[1/"),
        "Expected step numbering in output",
      );
      assert(
        result.stdout.includes("DRY RUN"),
        "Expected dry run indicator in output",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-tests omits test step",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--skip-tests"]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Running tests"),
        "Expected test step to be skipped",
      );
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step to be present",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-discovery omits discovery steps",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--skip-discovery"]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Building discovery"),
        "Expected discovery build step to be skipped",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --lint-only only shows fmt and lint steps",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--lint-only"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step",
      );
      assert(
        result.stdout.includes("Linting"),
        "Expected lint step",
      );
      assert(
        !result.stdout.includes("Type-checking"),
        "Expected type-check to be excluded in lint-only mode",
      );
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be excluded in lint-only mode",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --check-only only shows type-check step",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--check-only"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("Type-checking"),
        "Expected type-check step",
      );
      assert(
        !result.stdout.includes("Formatting"),
        "Expected format to be excluded in check-only mode",
      );
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be excluded in check-only mode",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh rejects unknown flags",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--unknown-flag"]);
      assert(result.code !== 0, "Expected non-zero exit code for unknown flag");
      assert(
        result.stderr.includes("Unknown option"),
        "Expected error message about unknown option",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-tests --skip-discovery combines skips",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality([
        "--dry-run",
        "--skip-tests",
        "--skip-discovery",
      ]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be skipped",
      );
      assert(
        !result.stdout.includes("Building discovery"),
        "Expected discovery to be skipped",
      );
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step to remain",
      );
      assert(
        result.stdout.includes("Type-checking"),
        "Expected type-check step to remain",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --help output documents exit codes",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assert(
        result.stdout.includes("Exit codes"),
        "Expected help to document exit codes",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run shows progress numbering",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run"]);
      assertEquals(result.code, 0);
      const stepPattern = /\[\d+\/\d+\]/;
      assert(
        stepPattern.test(result.stdout),
        "Expected [N/M] step numbering format in output",
      );
    },
  },
);

/**
 * Issue #2742 — quality.sh must enforce the same supply-chain quarantine
 * window as bump-deps.sh / docs/CORE_DEPENDENCY_POLICY.md. Without
 * `--minimum-dependency-age`, any developer running `./quality.sh` with the
 * deps step enabled silently bypasses the VIBE_BUMP_QUARANTINE_HOURS gate
 * and may pull in a too-recent (potentially malicious) registry version.
 */
Deno.test({
  name:
    "quality.sh dep update passes --minimum-dependency-age (Issue #2742 quarantine)",
  permissions: { read: true },
  fn: async () => {
    const body = await Deno.readTextFile("./quality.sh");
    assert(
      body.includes("VIBE_BUMP_QUARANTINE_HOURS"),
      "quality.sh must honour VIBE_BUMP_QUARANTINE_HOURS for the dep update",
    );
    assert(
      body.includes("--minimum-dependency-age"),
      "quality.sh must pass --minimum-dependency-age to `deno outdated --update --latest`",
    );

    // The flag must apply specifically to the `deno outdated --update --latest`
    // invocation, not appear unused elsewhere.
    const outdatedBlock =
      /deno outdated --update --latest[\s\S]{0,200}?--minimum-dependency-age=\$\{?QUALITY_QUARANTINE_MINUTES\}?/;
    assert(
      outdatedBlock.test(body),
      "quality.sh must call `deno outdated --update --latest` with `--minimum-dependency-age=${QUALITY_QUARANTINE_MINUTES}`",
    );
  },
});

Deno.test({
  name:
    "quality.sh rejects non-integer VIBE_BUMP_QUARANTINE_HOURS (Issue #2742)",
  permissions: { run: true, read: true, env: true },
  fn: async () => {
    const command = new Deno.Command("bash", {
      args: ["./quality.sh", "--lint-only"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        VIBE_BUMP_QUARANTINE_HOURS: "not-a-number",
      },
    });
    const output = await command.output();
    // --lint-only sets RUN_DEPS=true (only RUN_TYPE_CHECK/RUN_DISCOVERY/
    // RUN_WASM/RUN_TESTS are cleared), so the validation guard must fire.
    assert(
      output.code !== 0,
      "quality.sh must reject non-integer VIBE_BUMP_QUARANTINE_HOURS",
    );
    const stderr = new TextDecoder().decode(output.stderr);
    assert(
      stderr.includes("VIBE_BUMP_QUARANTINE_HOURS") &&
        stderr.includes("non-negative integer"),
      `Expected validation error in stderr; got: ${stderr}`,
    );
  },
});
