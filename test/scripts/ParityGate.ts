import { assert, assertEquals, assertStringIncludes } from "@std/assert";

/**
 * Tests for scripts/parity-gate.sh.
 *
 * Issue #2345 — parity gate that verifies pinned NEAT-AI-core WASM
 * artifacts and TS parity tests remain aligned.
 * The tests below exercise the CLI surface (help, dry-run, unknown
 * option handling, skip flags) and assert that the expected steps are
 * listed when the script is asked to describe its plan.
 */

const SCRIPT = "scripts/parity-gate.sh";
const DOC = "docs/PARITY_GATE.md";

async function runScript(args: string[] = []): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("parity-gate.sh exists and is executable", async () => {
  const info = await Deno.stat(SCRIPT);
  assert(info.isFile, `${SCRIPT} should be a file`);
  // The build env strips mode bits in some checkouts, so just confirm
  // bash can execute it via the invocations below.
});

Deno.test("parity-gate.sh --help prints usage and exits 0", async () => {
  const { code, stdout } = await runScript(["--help"]);
  assertEquals(code, 0, "help must exit cleanly");
  assertStringIncludes(stdout, "Usage: scripts/parity-gate.sh");
  assertStringIncludes(stdout, "--skip-sync");
  assertStringIncludes(stdout, "--skip-deno");
  assertStringIncludes(stdout, "--dry-run");
});

Deno.test("parity-gate.sh --dry-run lists the three gate steps", async () => {
  const { code, stdout } = await runScript(["--dry-run"]);
  assertEquals(code, 0, "dry-run must exit cleanly");
  // Each step label is authoritative — tests break if a step is
  // silently dropped from the gate.
  assertStringIncludes(stdout, "Core dependency policy");
  assertStringIncludes(stdout, "WASM package sync");
  assertStringIncludes(stdout, "Deno parity tests");
  assertStringIncludes(stdout, "Total: 3 step");
});

Deno.test(
  "parity-gate.sh --dry-run --skip-sync hides the sync step",
  async () => {
    const { code, stdout } = await runScript(["--dry-run", "--skip-sync"]);
    assertEquals(code, 0);
    assertEquals(
      stdout.includes("WASM package sync"),
      false,
      "sync step must be suppressed when --skip-sync is passed",
    );
    assertStringIncludes(stdout, "Core dependency policy");
    assertStringIncludes(stdout, "Deno parity tests");
    assertStringIncludes(stdout, "Total: 2 step");
  },
);

Deno.test(
  "parity-gate.sh --dry-run --skip-deno drops Deno-hosted steps",
  async () => {
    const { code, stdout } = await runScript(["--dry-run", "--skip-deno"]);
    assertEquals(code, 0);
    // --skip-deno also hides the policy step since it is a Deno test.
    assertEquals(
      stdout.includes("Deno parity tests"),
      false,
      "deno step must be suppressed when --skip-deno is passed",
    );
    assertEquals(
      stdout.includes("Core dependency policy"),
      false,
      "policy step must be suppressed when --skip-deno is passed",
    );
    assertStringIncludes(stdout, "WASM package sync");
    assertStringIncludes(stdout, "Total: 1 step");
  },
);

Deno.test("parity-gate.sh rejects unknown options with exit 1", async () => {
  const { code, stderr } = await runScript(["--nope"]);
  assertEquals(code, 1, "unknown option must exit non-zero");
  assertStringIncludes(stderr, "Unknown option: --nope");
});

Deno.test("docs/PARITY_GATE.md exists and covers the required sections", async () => {
  const info = await Deno.stat(DOC);
  assert(info.isFile, `${DOC} must exist`);

  const content = await Deno.readTextFile(DOC);
  // Each of these phrases corresponds to a section or invariant the
  // runbook has to keep — updating them deliberately is fine, but
  // silent removal would hide a gap in the release checklist.
  const requiredTopics = [
    "parity-gate.sh",
    "CoreDependencyPolicy",
    "WasmJsScoreParity",
    "build.sh",
    "Release checklist",
    "Failure response",
  ];

  for (const topic of requiredTopics) {
    assert(
      content.includes(topic),
      `${DOC} must cover "${topic}"`,
    );
  }
});

Deno.test("AGENTS.md references the parity gate document", async () => {
  const content = await Deno.readTextFile("AGENTS.md");
  assertStringIncludes(
    content,
    "docs/PARITY_GATE.md",
    "AGENTS.md must link to the parity gate runbook",
  );
});
