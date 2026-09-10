import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runSourcedFns } from "./_buildShHarness.ts";

/**
 * Issue #3990 — `build.sh` resolved the upstream revision with `gh api`
 * alone. `gh` needs an authenticated session even for a public repository, so
 * every unattended dependency-bump run aborted with "Could not resolve commit
 * SHA", the bump was reverted, and dependency updates stopped reaching PRs.
 *
 * These tests drive the real `resolve_upstream_rev()` out of `build.sh` with
 * stub `gh` / `git` / `curl` binaries on PATH, so each strategy and the
 * fail-loud path are exercised without touching the network.
 */

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "89abcdef0123456789abcdef0123456789abcdef";

/** A stub binary: the shell body it runs when invoked. */
type Stubs = Record<string, string>;

/**
 * Create a temp directory of stub executables and return its path.
 *
 * Real `awk` and `sed` are symlinked in alongside the stubs so the resolver's
 * text handling still works when PATH is reduced to the stub directory.
 */
function makeStubBin(stubs: Stubs): string {
  // Synchronous throughout: the writes are tiny and a loop of awaits would
  // serialise anyway.
  const dir = Deno.makeTempDirSync({ prefix: "neat-rev-stub-" });
  for (const [name, body] of Object.entries(stubs)) {
    const path = `${dir}/${name}`;
    Deno.writeTextFileSync(path, `#!/bin/sh\n${body}\n`);
    Deno.chmodSync(path, 0o755);
  }
  for (const tool of ["awk", "sed", "printf", "timeout"]) {
    const real = `/usr/bin/${tool}`;
    try {
      Deno.lstatSync(real);
      Deno.symlinkSync(real, `${dir}/${tool}`);
    } catch {
      // Tool absent or already stubbed — the resolver degrades without it.
    }
  }
  return dir;
}

/**
 * Run `resolve_upstream_rev` from build.sh against the given stub binaries.
 *
 * PATH is reduced to the stub directory, so a tool with no stub is genuinely
 * absent — that is how the "not on PATH" branches are reached.
 */
async function runResolve(
  stubs: Stubs,
  { ref = "Develop", env = "" }: { ref?: string; env?: string } = {},
) {
  const dir = makeStubBin(stubs);
  try {
    return await runSourcedFns(
      ["resolve_upstream_rev"],
      `PATH='${dir}' ${env} resolve_upstream_rev 'stSoftwareAU/NEAT-AI-core' '${ref}'`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** A `gh` stub that behaves like an unauthenticated session. */
const GH_UNAUTHENTICATED =
  'echo "gh: To use GitHub CLI in an automated environment, set the GH_TOKEN environment variable." >&2\nexit 4';

Deno.test({
  name:
    "resolve_upstream_rev falls back to git ls-remote when gh has no session (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: `echo "${HEAD_SHA}\trefs/heads/Develop"`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
    assertStringIncludes(result.stderr, "git ls-remote");
  },
});

Deno.test({
  name: "resolve_upstream_rev prefers gh when it is authenticated (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: `echo "${HEAD_SHA}"`,
      git: `echo "${OTHER_SHA}\trefs/heads/Develop"`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(
      result.stdout.trim(),
      HEAD_SHA,
      "gh is the only strategy that can read a private repo, so it wins",
    );
  },
});

Deno.test({
  name: "resolve_upstream_rev peels an annotated tag to its commit SHA (#3990)",
  fn: async () => {
    // ls-remote lists the tag object before its peeled commit; the commit is
    // the revision the bundle is published against.
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git:
        `echo "${OTHER_SHA}\trefs/tags/v1.2.3"\necho "${HEAD_SHA}\trefs/tags/v1.2.3^{}"`,
    }, { ref: "v1.2.3" });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
  },
});

Deno.test({
  name: "resolve_upstream_rev falls back to the REST API over curl (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      curl:
        `echo '{'\necho '  "sha": "${HEAD_SHA}",'\necho '  "commit": { "tree": { "sha": "${OTHER_SHA}" } }'\necho '}'`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(
      result.stdout.trim(),
      HEAD_SHA,
      "the commit SHA is the first sha in the response, not the tree sha",
    );
  },
});

Deno.test({
  name:
    "resolve_upstream_rev sends the token to curl when one is exported (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      // Only answer when the Authorization header carries the token.
      curl:
        `case "$*" in\n  *"Bearer s3cret"*) echo '{ "sha": "${HEAD_SHA}" }' ;;\n  *) exit 22 ;;\nesac`,
    }, { env: "GITHUB_TOKEN=s3cret" });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
  },
});

Deno.test({
  name:
    "resolve_upstream_rev fails loud and names every strategy it tried (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      curl: "exit 22",
    });
    assert(result.code !== 0, "an unresolvable ref must not return success");
    assertEquals(result.stdout.trim(), "", "no SHA may be printed on failure");
    assertStringIncludes(result.stderr, "Could not resolve commit SHA");
    assertStringIncludes(result.stderr, "gh api");
    assertStringIncludes(result.stderr, "git ls-remote");
    assertStringIncludes(result.stderr, "curl");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev reports the tools that are absent from PATH (#3990)",
  fn: async () => {
    // No stubs at all: every strategy's binary is missing.
    const result = await runResolve({});
    assert(result.code !== 0, "no resolver available means no success");
    assertStringIncludes(result.stderr, "not on PATH");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev rejects a malformed SHA rather than passing it on (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: 'echo "not-a-sha"',
      git: 'echo "zzzz\trefs/heads/Develop"',
      curl: "exit 22",
    });
    assert(result.code !== 0, "a malformed SHA must not be accepted");
    assertEquals(result.stdout.trim(), "");
  },
});
