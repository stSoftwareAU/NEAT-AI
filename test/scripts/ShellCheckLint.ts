import { assert, assertEquals } from "@std/assert";

/**
 * Validates that all shell scripts in the repository pass ShellCheck at
 * `warning` severity, matching the gate enforced by
 * `.github/workflows/shellcheck.yml` (Issue #2361).
 *
 * The workflow lints via the preinstalled koalaman/shellcheck binary at
 *   severity: warning
 * across every `*.sh` script (Issue #3426 dropped the unmaintained
 * `ludeeus/action-shellcheck` wrapper in favour of running the binary
 * directly), so this test mirrors those inputs locally. The test is skipped
 * when `shellcheck` is not installed, so it cannot block contributors who do
 * not yet have the tool available.
 */

async function hasShellCheck(): Promise<boolean> {
  try {
    const cmd = new Deno.Command("shellcheck", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code } = await cmd.output();
    return code === 0;
  } catch {
    return false;
  }
}

async function findShellScripts(): Promise<string[]> {
  const cmd = new Deno.Command("find", {
    args: [
      ".",
      "-name",
      "*.sh",
      "-type",
      "f",
      "-not",
      "-path",
      "./.git/*",
      "-not",
      "-path",
      "*/target/*",
      "-not",
      "-path",
      "*/node_modules/*",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim().split("\n").filter((l) =>
    l.length > 0
  );
}

Deno.test("all shell scripts pass shellcheck --severity=warning", async () => {
  if (!(await hasShellCheck())) {
    console.warn("shellcheck not installed — skipping");
    return;
  }
  const scripts = await findShellScripts();
  assert(scripts.length > 0, "Expected to find at least one shell script");

  const cmd = new Deno.Command("shellcheck", {
    args: ["--severity=warning", ...scripts],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);
  assertEquals(
    code,
    0,
    `shellcheck reported warnings/errors:\n${out}\n${err}`,
  );
});

Deno.test("shellcheck workflow file exists and is well-formed", async () => {
  const path = ".github/workflows/shellcheck.yml";
  const stat = await Deno.stat(path).catch(() => null);
  assert(stat?.isFile, `${path} must exist`);

  const body = await Deno.readTextFile(path);
  // Must NOT use the unmaintained ludeeus/action-shellcheck wrapper — Issue
  // #3426 replaced it with the preinstalled binary.
  assert(
    !body.includes("ludeeus/action-shellcheck"),
    "workflow must not use the unmaintained ludeeus/action-shellcheck (Issue #3426)",
  );
  // Must invoke the shellcheck binary directly via a run: step.
  assert(
    /shellcheck\s+--severity=warning/.test(body),
    "workflow must run shellcheck --severity=warning directly",
  );
  // Must run on pull_request so the gate triggers on every PR.
  assert(
    body.includes("pull_request"),
    "workflow must trigger on pull_request",
  );
  // Must apply at least `warning` severity.
  assert(
    /--severity=warning/.test(body),
    "workflow must lint at severity warning",
  );
  // Must reference the upstream koalaman/shellcheck project so the workflow
  // sync detector recognises the lint gate (Issue #2430).
  assert(
    body.includes("koalaman/shellcheck"),
    "workflow must reference koalaman/shellcheck (the upstream tool)",
  );
});
