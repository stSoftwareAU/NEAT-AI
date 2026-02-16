import { assert, assertEquals } from "@std/assert";

/**
 * Validates that all shell scripts in the repository have valid bash syntax.
 *
 * Issue #1489 - Learnings from NEAT-AI-Discovery runlib.sh.
 */

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
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();
  return output.split("\n").filter((line) => line.length > 0);
}

async function checkBashSyntax(scriptPath: string): Promise<boolean> {
  const cmd = new Deno.Command("bash", {
    args: ["-n", scriptPath],
    stdout: "piped",
    stderr: "piped",
  });
  const { code } = await cmd.output();
  return code === 0;
}

Deno.test("all shell scripts pass bash -n syntax check", async () => {
  const scripts = await findShellScripts();
  assert(scripts.length > 0, "Expected to find at least one shell script");

  const results = await Promise.all(
    scripts.map(async (script) => ({
      script,
      valid: await checkBashSyntax(script),
    })),
  );
  const failures = results
    .filter((r) => !r.valid)
    .map((r) => r.script);

  assertEquals(
    failures.length,
    0,
    `Bash syntax errors in: ${failures.join(", ")}`,
  );
});

Deno.test("scripts/rustlib.sh exists and is sourceable", async () => {
  const cmd = new Deno.Command("bash", {
    args: ["-c", "source scripts/rustlib.sh"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  const errOutput = new TextDecoder().decode(stderr);
  assertEquals(
    code,
    0,
    `scripts/rustlib.sh should be sourceable without errors: ${errOutput}`,
  );
});

Deno.test("scripts/rustlib.sh exports require_rust_tools function", async () => {
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      "source scripts/rustlib.sh && type require_rust_tools | head -1",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();
  assertEquals(code, 0, "require_rust_tools should be a defined function");
  assert(
    output.includes("function"),
    `Expected function declaration, got: ${output}`,
  );
});
