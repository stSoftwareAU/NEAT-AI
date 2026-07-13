import { assert, assertEquals, assertStringIncludes } from "@std/assert";

/**
 * Tests for scripts/verify_jsr_provenance.sh.
 *
 * Issue #3334 (parent #3332) — the publish pipeline must fail LOUDLY when a
 * JSR release carries no Sigstore provenance (rekorLogId null/absent), rather
 * than succeeding silently as it did for v5.8.1.
 *
 * The tests drive the script's real behaviour against local meta fixtures
 * (via --meta-file, bypassing the network) and assert on exit code and
 * message — never grepping the source.
 */

const SCRIPT = "scripts/verify_jsr_provenance.sh";

async function runScript(
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    stdout: "piped",
    stderr: "piped",
    // Keep retries fast and bounded for the null path.
    env: { VERIFY_JSR_MAX_ATTEMPTS: "1", VERIFY_JSR_RETRY_DELAY: "0", ...env },
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withMetaFile(
  contents: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, contents);
    await fn(path);
  } finally {
    await Deno.remove(path).catch(() => {});
  }
}

Deno.test("verify_jsr_provenance.sh exists", async () => {
  const info = await Deno.stat(SCRIPT);
  assert(info.isFile, `${SCRIPT} should be a file`);
});

Deno.test("verify_jsr_provenance.sh --help prints usage and exits 0", async () => {
  const { code, stdout } = await runScript(["--help"]);
  assertEquals(code, 0, "help must exit cleanly");
  assertStringIncludes(stdout, "Usage: scripts/verify_jsr_provenance.sh");
  assertStringIncludes(stdout, "--meta-file");
  assertStringIncludes(stdout, "rekorLogId");
});

Deno.test("verify_jsr_provenance.sh rejects unknown options with exit 1", async () => {
  const { code, stderr } = await runScript(["--nope"]);
  assertEquals(code, 1, "unknown option must exit non-zero");
  assertStringIncludes(stderr, "Unknown option: --nope");
});

Deno.test("passes when rekorLogId is a non-null value", async () => {
  await withMetaFile(
    JSON.stringify({ rekorLogId: "108e9186e8c5677a" }),
    async (path) => {
      const { code, stdout } = await runScript([
        "--name",
        "@stsoftware/neat-ai",
        "--version",
        "5.9.0",
        "--meta-file",
        path,
      ]);
      assertEquals(code, 0, "non-null rekorLogId must pass");
      assertStringIncludes(stdout, "Provenance recorded");
      assertStringIncludes(stdout, "5.9.0");
    },
  );
});

Deno.test("fails loudly when rekorLogId is explicitly null", async () => {
  await withMetaFile(
    JSON.stringify({ rekorLogId: null }),
    async (path) => {
      const { code, stderr } = await runScript([
        "--name",
        "@stsoftware/neat-ai",
        "--version",
        "5.8.1",
        "--meta-file",
        path,
      ]);
      assertEquals(code, 1, "null rekorLogId must fail the job");
      assertStringIncludes(stderr, "No Sigstore provenance");
      assertStringIncludes(stderr, "5.8.1");
    },
  );
});

Deno.test("fails loudly when rekorLogId is absent", async () => {
  await withMetaFile(
    JSON.stringify({ version: "5.8.1", moduleGraph2: {} }),
    async (path) => {
      const { code, stderr } = await runScript([
        "--name",
        "@stsoftware/neat-ai",
        "--version",
        "5.8.1",
        "--meta-file",
        path,
      ]);
      assertEquals(code, 1, "absent rekorLogId must fail the job");
      assertStringIncludes(stderr, "No Sigstore provenance");
      assertStringIncludes(stderr, "@stsoftware/neat-ai");
    },
  );
});

Deno.test("fails loudly when the meta document cannot be fetched", async () => {
  const { code, stderr } = await runScript([
    "--name",
    "@stsoftware/neat-ai",
    "--version",
    "5.8.1",
    "--meta-file",
    "/nonexistent/does-not-exist.json",
  ]);
  assertEquals(code, 1, "unreachable meta must fail loudly");
  assertStringIncludes(stderr, "No Sigstore provenance");
});
