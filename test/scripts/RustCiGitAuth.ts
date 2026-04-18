import { assert, assertEquals } from "@std/assert";

/**
 * Tests for scripts/rust-ci-git-auth.sh.
 *
 * Issue #2344 — CI: allow Cargo to authenticate git dependencies (for the
 * external NEAT-AI-core crate) on GitHub Actions without requiring secrets
 * beyond those already available to the repo.
 *
 * The helper:
 *   - Enables `CARGO_NET_GIT_FETCH_WITH_CLI=true` so cargo reuses the `git`
 *     CLI (and thus any GITHUB_TOKEN extraheader injected by actions/checkout).
 *   - Rewrites `https://github.com/<org>/NEAT-AI-core.git` URLs to use the
 *     configured token / deploy key, if one is supplied.
 *   - Is a safe no-op when no secret is supplied (public crate case).
 */

const SCRIPT = "scripts/rust-ci-git-auth.sh";

async function sourceAndRun(snippet: string, env: Record<string, string> = {}) {
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      `set -euo pipefail; source "${Deno.cwd()}/${SCRIPT}"; ${snippet}`,
    ],
    env: { ...Deno.env.toObject(), ...env },
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

Deno.test("rust-ci-git-auth.sh exists and is sourceable", async () => {
  const info = await Deno.stat(SCRIPT);
  assert(info.isFile);
  const { code, stderr } = await sourceAndRun("true");
  assertEquals(code, 0, `script must source cleanly: ${stderr}`);
});

Deno.test("rust-ci-git-auth.sh exports configure_cargo_git_auth", async () => {
  const { code, stdout } = await sourceAndRun("type configure_cargo_git_auth");
  assertEquals(code, 0);
  assert(
    stdout.includes("function"),
    `configure_cargo_git_auth should be a function, got: ${stdout}`,
  );
});

Deno.test("configure_cargo_git_auth sets CARGO_NET_GIT_FETCH_WITH_CLI=true", async () => {
  const { code, stdout } = await sourceAndRun(
    'configure_cargo_git_auth >/dev/null; echo "$CARGO_NET_GIT_FETCH_WITH_CLI"',
  );
  assertEquals(code, 0);
  assertEquals(
    stdout.trim(),
    "true",
    "CARGO_NET_GIT_FETCH_WITH_CLI must be exported as 'true'",
  );
});

Deno.test("configure_cargo_git_auth is a no-op when no token is set", async () => {
  const home = await Deno.makeTempDir({ prefix: "rust-ci-git-auth-home-" });
  const { code, stderr } = await sourceAndRun(
    "configure_cargo_git_auth",
    { HOME: home, CARGO_GIT_TOKEN: "", GITHUB_TOKEN: "" },
  );
  assertEquals(code, 0, `no-op mode should succeed, stderr=${stderr}`);
  // No global git config should have been written.
  let wroteGlobal = false;
  try {
    const gc = await Deno.stat(`${home}/.gitconfig`);
    wroteGlobal = gc.isFile;
  } catch {
    wroteGlobal = false;
  }
  assertEquals(
    wroteGlobal,
    false,
    "must not write ~/.gitconfig when no token is configured",
  );
});

Deno.test("configure_cargo_git_auth installs an insteadOf rewrite when a token is set", async () => {
  const home = await Deno.makeTempDir({ prefix: "rust-ci-git-auth-home-" });
  const { code, stderr } = await sourceAndRun(
    "configure_cargo_git_auth",
    { HOME: home, CARGO_GIT_TOKEN: "ghp_exampletoken", GITHUB_TOKEN: "" },
  );
  assertEquals(code, 0, `stderr=${stderr}`);
  const gitconfig = await Deno.readTextFile(`${home}/.gitconfig`);
  assert(
    gitconfig.includes("insteadOf"),
    `expected insteadOf entry, got:\n${gitconfig}`,
  );
  assert(
    gitconfig.includes("x-access-token:ghp_exampletoken"),
    "token must be embedded in the rewritten URL",
  );
});
