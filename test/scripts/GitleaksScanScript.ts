/**
 * Issue #3950 — `scripts/gitleaks-scan.sh` is the licence-less secret-scanning
 * fallback for `.github/workflows/quality.yml`. `gitleaks/gitleaks-action`
 * exits with `ErrLicense` before scanning anything when no organisation
 * licence is present (Dependabot-authored PRs receive no Actions secrets), so
 * the fallback is the only thing standing between an unscanned diff and a
 * green job.
 *
 * These are "what" tests: they run the real script and assert on what it
 * actually did — the scanner arguments it produced, and its exit code. The
 * scanner itself is a stub so the tests stay hermetic and fast; the download
 * tests serve a tarball over `file://` rather than reaching the network.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/gitleaks-scan.sh");

/** A stand-in for the gitleaks CLI: records its argv, then exits as told. */
const STUB_SOURCE = [
  "#!/usr/bin/env bash",
  'printf "%s\\n" "$@" >> "$STUB_ARGV_FILE"',
  'exit "${STUB_EXIT:-0}"',
  "",
].join("\n");

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** Arguments the stub scanner was invoked with; empty when it never ran. */
  argv: string[];
}

async function sh(args: string[], cwd: string): Promise<void> {
  const out = await new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(
    out.code,
    0,
    `${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`,
  );
}

/** A throwaway git repository with two commits. */
async function makeRepo(): Promise<
  { dir: string; base: string; head: string }
> {
  const dir = await Deno.makeTempDir({ prefix: "neat-gitleaks-" });
  await sh(["git", "init", "-q", "."], dir);
  await sh(["git", "config", "user.email", "test@example.com"], dir);
  await sh(["git", "config", "user.name", "Test"], dir);
  await Deno.writeTextFile(join(dir, "a.txt"), "first\n");
  await sh(["git", "add", "-A"], dir);
  await sh(["git", "commit", "-qm", "base"], dir);
  const base = await revParse(dir);
  await Deno.writeTextFile(join(dir, "b.txt"), "second\n");
  await sh(["git", "add", "-A"], dir);
  await sh(["git", "commit", "-qm", "head"], dir);
  const head = await revParse(dir);
  return { dir, base, head };
}

async function revParse(dir: string): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: dir,
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout).trim();
}

async function writeStub(path: string): Promise<void> {
  await Deno.writeTextFile(path, STUB_SOURCE);
  await Deno.chmod(path, 0o755);
}

/** Run the script in `cwd` with `env`, and collect what the stub scanner saw. */
async function runScript(
  cwd: string,
  env: Record<string, string>,
): Promise<Run> {
  const argvFile = await Deno.makeTempFile({ prefix: "neat-gitleaks-argv-" });
  const out = await new Deno.Command("bash", {
    args: [SCRIPT, "."],
    cwd,
    env: { ...env, STUB_ARGV_FILE: argvFile },
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const recorded = (await Deno.readTextFile(argvFile)).trim();
  await Deno.remove(argvFile);
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
    argv: recorded === "" ? [] : recorded.split("\n"),
  };
}

const PERMS = { run: true, read: true, write: true, env: true } as const;

Deno.test({
  name:
    "gitleaks-scan.sh scans the pull-request commit range when it is reachable",
  permissions: PERMS,
  fn: async () => {
    const { dir, base, head } = await makeRepo();
    const stub = join(dir, "stub-gitleaks");
    await writeStub(stub);

    const run = await runScript(dir, {
      GITLEAKS_BIN: stub,
      BASE_SHA: base,
      HEAD_SHA: head,
    });

    assertEquals(run.code, 0, run.stderr);
    assertEquals(run.argv[0], "git");
    assert(
      run.argv.includes(`--log-opts=${base}..${head}`),
      `expected the PR range to be scanned, got: ${run.argv.join(" ")}`,
    );
    assert(
      run.argv.includes("--exit-code") && run.argv.includes("1"),
      `expected a leak to fail the scan, got: ${run.argv.join(" ")}`,
    );
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name:
    "gitleaks-scan.sh scans the whole tree when the base commit is unreachable",
  permissions: PERMS,
  fn: async () => {
    const { dir, head } = await makeRepo();
    const stub = join(dir, "stub-gitleaks");
    await writeStub(stub);

    // `gitleaks git --log-opts` exits 0 on a range git cannot resolve, so an
    // unreachable base must widen the scan rather than quietly scan nothing.
    const run = await runScript(dir, {
      GITLEAKS_BIN: stub,
      BASE_SHA: "0".repeat(40),
      HEAD_SHA: head,
    });

    assertEquals(run.code, 0, run.stderr);
    assertEquals(run.argv[0], "dir");
    assert(
      !run.argv.some((a) => a.startsWith("--log-opts=")),
      `expected no commit range, got: ${run.argv.join(" ")}`,
    );
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name:
    "gitleaks-scan.sh scans the whole tree when no commit range is supplied",
  permissions: PERMS,
  fn: async () => {
    // The workflow_dispatch path: no pull request, so no base/head shas.
    const { dir } = await makeRepo();
    const stub = join(dir, "stub-gitleaks");
    await writeStub(stub);

    const run = await runScript(dir, { GITLEAKS_BIN: stub });

    assertEquals(run.code, 0, run.stderr);
    assertEquals(run.argv[0], "dir");
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "gitleaks-scan.sh fails loud when the scanner reports a leak",
  permissions: PERMS,
  fn: async () => {
    const { dir, base, head } = await makeRepo();
    const stub = join(dir, "stub-gitleaks");
    await writeStub(stub);

    const run = await runScript(dir, {
      GITLEAKS_BIN: stub,
      BASE_SHA: base,
      HEAD_SHA: head,
      STUB_EXIT: "1",
    });

    assertEquals(run.code, 1, "a reported leak must fail the step");
    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "gitleaks-scan.sh refuses an installed binary that is not executable",
  permissions: PERMS,
  fn: async () => {
    const { dir } = await makeRepo();
    const notABinary = join(dir, "not-executable");
    await Deno.writeTextFile(notABinary, "#!/usr/bin/env bash\n");

    const run = await runScript(dir, { GITLEAKS_BIN: notABinary });

    assert(run.code !== 0, "a non-executable scanner must fail the step");
    assertStringIncludes(run.stderr, "not executable");
    assertEquals(run.argv, []);
    await Deno.remove(dir, { recursive: true });
  },
});

/**
 * Publish a tarball holding the stub scanner at
 * `<served>/v<version>/<asset>`, and return its real SHA-256.
 */
async function publishStubRelease(
  version: string,
  asset: string,
): Promise<{ served: string; sha256: string }> {
  const served = await Deno.makeTempDir({ prefix: "neat-gitleaks-release-" });
  const stage = join(served, "stage");
  await Deno.mkdir(stage);
  await writeStub(join(stage, "gitleaks"));
  const releaseDir = join(served, `v${version}`);
  await Deno.mkdir(releaseDir);
  await sh(["tar", "-czf", join(releaseDir, asset), "gitleaks"], stage);

  const bytes = await Deno.readFile(join(releaseDir, asset));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { served, sha256 };
}

Deno.test({
  name: "gitleaks-scan.sh downloads and runs a release whose checksum matches",
  permissions: PERMS,
  fn: async () => {
    const version = "9.9.9";
    const asset = "gitleaks_9.9.9_test.tar.gz";
    const { served, sha256 } = await publishStubRelease(version, asset);
    const { dir } = await makeRepo();

    const run = await runScript(dir, {
      GITLEAKS_VERSION: version,
      GITLEAKS_ASSET: asset,
      GITLEAKS_SHA256: sha256,
      GITLEAKS_BASE_URL: `file://${served}`,
    });

    assertEquals(run.code, 0, run.stderr);
    assertEquals(run.argv[0], "dir");
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(served, { recursive: true });
  },
});

Deno.test({
  name:
    "gitleaks-scan.sh refuses to run a release whose checksum does not match",
  permissions: PERMS,
  fn: async () => {
    const version = "9.9.9";
    const asset = "gitleaks_9.9.9_test.tar.gz";
    const { served } = await publishStubRelease(version, asset);
    const { dir } = await makeRepo();

    const run = await runScript(dir, {
      GITLEAKS_VERSION: version,
      GITLEAKS_ASSET: asset,
      GITLEAKS_SHA256: "f".repeat(64),
      GITLEAKS_BASE_URL: `file://${served}`,
    });

    assert(run.code !== 0, "a tampered download must fail the step");
    assertStringIncludes(run.stderr, "checksum mismatch");
    assertEquals(run.argv, [], "the unverified binary must never be executed");
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(served, { recursive: true });
  },
});
